export async function onRequest(context) {
  return new Response(
    JSON.stringify({
      ok: true,
      message: "ai-proxy route is active",
      method: context.request.method,
      url: context.request.url
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}
