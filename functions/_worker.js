export async function onRequest(context) {
// CLOUDFLARE WORKER SCRIPT – Secure AI Proxy with Rate Limiting & Free CF Models
// Routes requests to AI providers with key validation and IP throttling

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/';

// Rate limit: 10 requests per minute per IP
const RATE_LIMIT = 10;
const RATE_WINDOW = 60; // seconds

// Atomic rate limiting helper
async function checkRateLimit(kv, key, limit, window) {
const value = await kv.get(key);
const count = value ? parseInt(value) : 0;
if (count >= limit) return false;
await kv.put(key, String(count + 1), { expirationTtl: window });
return true;
}

export default {
async fetch(request, env, ctx) {
// Only allow POST
if (request.method !== 'POST') {
return new Response(JSON.stringify({ error: 'Method not allowed' }), {
status: 405,
headers: { 'Content-Type': 'application/json' }
});
}

try {
const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
const { model, prompt, base64Image } = await request.json();

// Input validation
if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
return new Response(JSON.stringify({ error: 'Invalid prompt' }), {
status: 400,
headers: { 'Content-Type': 'application/json' }
});
}

if (prompt.length > 2000) {
return new Response(JSON.stringify({ error: 'Prompt exceeds 2000 character limit' }), {
status: 400,
headers: { 'Content-Type': 'application/json' }
});
}

// Rate limiting
const rateLimitKey = `ratelimit:${clientIP}:${model}`;
if (env.RATE_LIMIT_KV) {
const canProceed = await checkRateLimit(env.RATE_LIMIT_KV, rateLimitKey, RATE_LIMIT, RATE_WINDOW);
if (!canProceed) {
return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please wait 60 seconds.' }), {
status: 429,
headers: { 'Content-Type': 'application/json' }
});
}
}

// Route to appropriate handler
let result;
if (model === 'gemini') {
result = await handleGemini(prompt, base64Image, env);
} else if (model === 'deepseek') {
result = await handleDeepSeek(prompt, env);
} else if (model === 'kimi') {
result = await handleKimi(prompt, env);
} else if (model === 'flux') {
result = await handleFlux(prompt, env);
} else if (model === 'cf-deepseek') {
result = await handleCF('@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', prompt, env);
} else if (model === 'cf-mobilellama') {
result = await handleCF('@cf/meta-llama/Llama-2-7b-chat-hf', prompt, env);
} else if (model === 'cf-flan') {
result = await handleCF('@cf/google/flan-t5-small-835m', prompt, env);
} else {
return new Response(JSON.stringify({ error: 'Invalid model' }), {
status: 400,
headers: { 'Content-Type': 'application/json' }
});
}

return new Response(JSON.stringify(result), {
headers: { 'Content-Type': 'application/json' }
});

} catch (error) {
console.error('Worker Error:', error);
return new Response(JSON.stringify({ error: error.message }), {
status: 500,
headers: { 'Content-Type': 'application/json' }
});
}
}
};

// ---------- API HELPER FUNCTIONS ----------
async function handleGemini(prompt, base64Image, env) {
const apiKey = env.GEMINI_KEY;
if (!apiKey) return { error: 'GEMINI_KEY missing. Add it in Cloudflare Settings.' };

const GEMINI_MODEL = 'gemini-2.0-flash';
const url = `${GEMINI_ENDPOINT}${GEMINI_MODEL}:generateContent?key=${apiKey}`;
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
if (data.error) return { error: data.error.message };
return { response: data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response.' };
}

async function handleDeepSeek(prompt, env) {
const apiKey = env.DEEPSEEK_KEY;
if (!apiKey) return { error: 'DEEPSEEK_KEY missing. Add it in Cloudflare Settings.' };

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
return { response: data.choices?.[0]?.message?.content || 'Error: No content received.' };
}

async function handleKimi(prompt, env) {
const apiKey = env.KIMI_TOKEN;
if (!apiKey) return { error: 'KIMI_TOKEN missing. Add it in Cloudflare Settings.' };

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
return { response: data.choices?.[0]?.message?.content || 'Error: No content received.' };
}

async function handleFlux(prompt, env) {
const token = env.HF_TOKEN;
if (!token) return { error: 'HF_TOKEN missing. Add it in Cloudflare Settings.' };

const FLUX_MODEL = 'black-forest-labs/FLUX.1-schnell';
const response = await fetch(`https://api-inference.huggingface.co/models/${FLUX_MODEL}`, {
method: 'POST',
headers: {
'Authorization': `Bearer ${token}`,
'Content-Type': 'application/json'
},
body: JSON.stringify({ inputs: prompt })
});

if (!response.ok) {
return { error: `Flux API Error: ${response.statusText}` };
}

// Convert Blob to base64
const imageBlob = await response.blob();
const arrayBuffer = await imageBlob.arrayBuffer();
const bytes = new Uint8Array(arrayBuffer);
const base64String = btoa(String.fromCharCode(...bytes));
return { base64Image: base64String };
}

// ---------- FREE CLOUDFLARE AI HELPER ----------
async function handleCF(modelId, prompt, env) {
const ai = env.AI; // Cloudflare gives this for free
const answer = await ai.run(modelId, { prompt });
return { response: answer.response || answer };

}
  }
