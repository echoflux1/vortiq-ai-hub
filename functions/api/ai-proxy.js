// PRODUCTION AI ROUTER – Handles Text & Image Models + Auto-Fallback
export async function onRequest(context) {
  const { request, env } = context;
  
  // 1. Only POST allowed
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { model, prompt, base64Image } = body;

    // 2. Validate input
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (prompt.length > 2000) {
      return new Response(JSON.stringify({ error: "Prompt exceeds 2000 character limit" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3. Verify AI binding for CF models
    if ((model.startsWith('cf-')) && !env.AI) {
      return new Response(JSON.stringify({ error: "AI binding not found. Add it in Cloudflare Settings → Bindings → AI." }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. Rate limiting (protects free tier)
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `ratelimit:${clientIP}:${model}`;
    if (env.RATE_LIMIT_KV) {
      const canProceed = await checkRateLimit(env.RATE_LIMIT_KV, rateLimitKey, 10, 60);
      if (!canProceed) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait 60 seconds." }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 5. Route to correct AI handler (with auto-fallback)
    let result;
    
    // --- FREE CLOUDFLARE MODELS (verified working globally) ---
    if (model === 'cf-llama-daily') {
      result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt });
    } else if (model === 'cf-llama-speed') {
      result = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', { prompt });
    } else if (model === 'cf-flux') {
      result = await handleCFFlux(prompt, env);
    }
    
    // --- EXTERNAL APIs (with fallback when exhausted) ---
    else if (model === 'gemini') {
      result = await handleGemini(prompt, base64Image, env);
      if (result.error && result.error.includes('quota')) {
        result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt }); // Fallback
      }
    } else if (model === 'deepseek') {
      result = await handleDeepSeek(prompt, env);
      if (result.error && result.error.includes('exhausted')) {
        result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt }); // Fallback
      }
    } else if (model === 'kimi') {
      result = await handleKimi(prompt, env);
      if (result.error && result.error.includes('limit')) {
        result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt }); // Fallback
      }
    } else if (model === 'flux') {
      result = await handleFlux(prompt, env);
      if (result.error) {
        result = await handleCFFlux(prompt, env); // Fallback to CF
      }
    } else {
      return new Response(JSON.stringify({ error: "Invalid model selected" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 6. Return result to frontend
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ---------- RATE LIMITING HELPER ----------
async function checkRateLimit(kv, key, limit, window) {
  const value = await kv.get(key);
  const count = value ? parseInt(value) : 0;
  if (count >= limit) return false;
  await kv.put(key, String(count + 1), { expirationTtl: window });
  return true;
}

// ---------- CF FLUX IMAGE HANDLER (Regional) ----------
async function handleCFFlux(prompt, env) {
  try {
    // CF Flux requires longer prompts (min 10 chars)
    const enhancedPrompt = prompt.length < 10 
      ? `High quality, detailed, 4k image: ${prompt}` 
      : prompt;

    const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
      prompt: enhancedPrompt,
      guidance_scale: 7.5, // Image quality
      num_steps: 4         // Speed mode
    });
    
    // Check if result is empty
    if (!result || result.byteLength === 0) {
      return { error: 'CF Flux returned empty image. Try a more descriptive prompt (min 10 chars).' };
    }

    // Convert ArrayBuffer → base64
    const base64String = btoa(String.fromCharCode(...new Uint8Array(result)));
    return { base64Image: base64String };
  } catch (err) {
    return { error: `CF Flux failed: ${err.message}. Model may not be available in your region.` };
  }
}

// ---------- EXTERNAL API HELPERS (with quota checks) ----------
async function handleGemini(prompt, base64Image, env) {
  const apiKey = env.GEMINI_KEY;
  if (!apiKey) return { error: 'GEMINI_KEY missing. Add balance at Google AI Studio.' };
  
  const GEMINI_MODEL = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const parts = [{ text: prompt }];
  if (base64Image) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Image } });
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: parts }] })
  });
  
  const data = await response.json();
  if (data.error) {
    if (data.error.code === '429') return { error: 'Gemini quota exhausted. Switching to CF Llama (free).' };
    return { error: data.error.message };
  }
  return { response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.' };
}

async function handleDeepSeek(prompt, env) {
  const apiKey = env.DEEPSEEK_KEY;
  if (!apiKey) return { error: 'DEEPSEEK_KEY missing. Add balance at platform.deepseek.com' };
  
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  const data = await response.json();
  if (data.error?.type === 'insufficient_quota') {
    return { error: 'DeepSeek credit exhausted. Switching to CF Llama (free).', code: 'exhausted' };
  }
  return { response: data.choices?.[0]?.message?.content || 'Error: DeepSeek returned empty.' };
}

async function handleKimi(prompt, env) {
  const apiKey = env.KIMI_TOKEN;
  if (!apiKey) return { error: 'KIMI_TOKEN missing. Add balance at platform.moonshot.cn' };
  
  const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'kimi-k2-instruct',
      messages: [{ role: 'user', content: prompt }]
    })
  });
  
  const data = await response.json();
  if (data.error?.code === 'rate_limit_exceeded') {
    return { error: 'Kimi quota exhausted. Switching to CF Llama (free).', code: 'exhausted' };
  }
  return { response: data.choices?.[0]?.message?.content || 'Error: Kimi returned empty.' };
}

async function handleFlux(prompt, env) {
  const token = env.HF_TOKEN;
  if (!token) return { error: 'HF_TOKEN missing. Create at huggingface.co' };
  
  const FLUX_MODEL = 'black-forest-labs/FLUX.1-schnell';
  const response = await fetch(`https://api-inference.huggingface.co/models/${FLUX_MODEL}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ inputs: prompt })
  });
  
  if (response.status === 410) {
    return { error: 'HuggingFace Flux is deprecated. Use CF Llama models (free).', code: 'deprecated' };
  }
  if (!response.ok) return { error: `Flux API Error: ${response.statusText}` };
  
  const imageBlob = await response.blob();
  const arrayBuffer = await imageBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const base64String = btoa(String.fromCharCode(...bytes));
  return { base64Image: base64String };
}
