export function json(data: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

export function problem(status: number, message: string, extra: Record<string, unknown> = {}, headers: HeadersInit = {}): Response {
  return json({ error: message, ...extra }, status, headers);
}

/** CORS headers for browser calls from the public site; origins come from ALLOWED_ORIGINS. */
export function corsHeaders(request: Request, allowed: string | undefined): Record<string, string> {
  const origin = request.headers.get("Origin");
  const list = (allowed ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!origin || !list.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Read a body with a size limit so a large request can't exhaust the Worker. */
export async function readBody(request: Request, maxBytes: number): Promise<string | null> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > maxBytes) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).byteLength > maxBytes ? null : text;
}
