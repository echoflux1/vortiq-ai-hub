export async function onRequest(context) {
  try {
    const { request, env } = context;

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await request.json();
    const prompt = body.prompt;

    if (!prompt) {
      return new Response(
        JSON.stringify({ error: "Prompt is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await env.AI.run(
      "@cf/meta/llama-3-8b-instruct",
      {
        messages: [
          { role: "system", content: "You are a helpful AI assistant." },
          { role: "user", content: prompt }
        ]
      }
    );

    return new Response(
      JSON.stringify(result),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err.message || "Workers AI error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
