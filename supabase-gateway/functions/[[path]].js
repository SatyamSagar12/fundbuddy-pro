// Cloudflare Pages Function: forwards the app's Supabase traffic (sign-in and data API) to
// the Supabase project. Several Indian internet providers block *.supabase.co, which makes
// the apps fail with "Failed to fetch"; requests to this Cloudflare address are not blocked.
const DEFAULT_UPSTREAM = "https://tojgfdjfmmnywjjrzdkn.supabase.co";
const ALLOWED = /^\/(auth|rest|storage|functions)\/v1(\/|$)/;
// Cloudflare adds these on the way in; Supabase does not need them.
const DROP = ["host", "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "x-real-ip", "x-forwarded-proto", "x-forwarded-host", "cdn-loop"];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  if (!ALLOWED.test(url.pathname)) {
    return new Response("Supabase gateway is running.", { status: url.pathname === "/" ? 200 : 404 });
  }
  const headers = new Headers(request.headers);
  for (const name of DROP) headers.delete(name);
  const upstream = new URL(url.pathname + url.search, env.UPSTREAM || DEFAULT_UPSTREAM);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
  });
  return new Response(response.body, response);
}
