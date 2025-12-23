export async function onRequest(context) {
  try {
    const { request, env } = context;

    // 👇 IMPORTANT: handle only POST
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const body = await request.json();

    // TEMP DEBUG (very important)
    return new Response(
      JSON.stringify({
        ok: true,
        received: body,
        note: "POST reached ai-proxy"
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err.message || "Unknown error"
      }),
      { status: 500 }
    );
  }
}
