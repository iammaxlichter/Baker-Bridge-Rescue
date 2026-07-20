export async function onRequest(context) {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = context.env;

  const body = `window.SUPABASE_URL = "${SUPABASE_URL}";
window.SUPABASE_ANON_KEY = "${SUPABASE_ANON_KEY}";`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript",
    },
  });
}