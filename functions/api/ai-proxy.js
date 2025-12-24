// PRODUCTION AI ROUTER – Handles Text & Image Models + Auto-Fallback
export async function onRequest(context) {
  const { request, env } = context;
  
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const body = await request.json();
    const { model, prompt, base64Image } = body;

    // Validate input
    if (!prompt || typeof prompt !== 'string') {
      return new Response(JSON.stringify({ error: "Prompt is required" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Verify AI binding for CF models
    if ((model.startsWith('cf-')) && !env.AI) {
      return new Response(JSON.stringify({ error: "AI binding not found." }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Rate limiting
    const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `ratelimit:${clientIP}:${model}`;
    if (env.RATE_LIMIT_KV) {
      const canProceed = await checkRateLimit(env.RATE_LIMIT_KV, rateLimitKey, 10, 60);
      if (!canProceed) {
        return new Response(JSON.stringify({ error: "Too many requests. Try again later." }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    let result;

    // Model Routing
    if (model === 'cf-llama-3.1-8b') {
      result = await handleLlama(prompt, env, '@cf/meta/llama-3.1-8b-instruct');
    } else if (model === 'cf-llama-3.3-70b') {
      result = await handleLlama(prompt, env, '@cf/meta/llama-3.3-70b-instruct');
    } else if (model === 'cf-flux') {
      // ✅ Updated Logic: Flux returns an object with a base64 string already.
      const aiResponse = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt });
      result = { base64Image: aiResponse.image }; 
    } else if (model === 'deepseek') {
      result = await handleDeepSeek(prompt, env);
    } else if (model === 'kimi') {
      result = await handleKimi(prompt, env);
    } else {
      return new Response(JSON.stringify({ error: "Unsupported model" }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ---------- Helper: Rate Limiter ----------
async function checkRateLimit(kv, key, limit, period) {
  const current = await kv.get(key);
  const count = current ? parseInt(current) : 0;
  if (count >= limit) return false;
  await kv.put(key, (count + 1).toString(), { expirationTtl: period });
  return true;
}

// ---------- Llama Helper ----------
async function handleLlama(prompt, env, modelPath) {
  const response = await env.AI.run(modelPath, {
    messages: [{ role: 'user', content: prompt }]
  });
  return { response: response.response || response.choices?.[0]?.message?.content || "No response" };
}

// ---------- DeepSeek Helper ----------
async function handleDeepSeek(prompt, env) {
  const apiKey = env.DEEPSEEK_TOKEN;
  if (!apiKey) return { error: 'DEEPSEEK_TOKEN missing. Add balance at platform.deepseek.com', code: 'missing_key' };
  
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
  if (data.error?.type === 'insufficient_quota') return { error: 'DeepSeek credit exhausted.', code: 'exhausted' };
  return { response: data.choices?.[0]?.message?.content || 'Error: DeepSeek returned empty.' };
}

// ---------- Kimi Helper ----------
async function handleKimi(prompt, env) {
  const apiKey = env.KIMI_TOKEN;
  if (!apiKey) return { error: 'KIMI_TOKEN missing. Add balance at platform.moonshot.cn', code: 'missing_key' };
  
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
  return { response: data.choices?.[0]?.message?.content || 'Error: Kimi returned empty.' };
}
