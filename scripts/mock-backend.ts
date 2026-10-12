/** Test-only endpoint. Never exchanges, logs, stores, or returns signup credentials. */
export function createMockHandler(allowedOrigin: string) {
  const origin = new URL(allowedOrigin);
  if (origin.origin !== allowedOrigin || !["http:", "https:"].includes(origin.protocol)) {
    throw new Error("Allowed origin must be an exact HTTP(S) origin without a trailing slash");
  }

  return async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const headers = new Headers({ "Cache-Control": "no-store", Vary: "Origin" });
    const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

    if (request.method === "GET" && path === "/health") {
      return json({ status: "ok", testOnly: true });
    }
    if (path !== "/api/onboarding") return json({ error: "Not found" }, 404);
    if (request.headers.get("Origin") !== allowedOrigin) {
      return json({ error: "Origin not allowed" }, 403);
    }

    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Access-Control-Allow-Credentials", "true");
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") {
      return json({ error: "Expected application/json" }, 415);
    }
    try {
      // Parse only to check valid JSON; do not retain or echo sensitive payloads.
      await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }
    return json({
      status: "test-only",
      testOnly: true,
      message: "Mock response only. WhatsApp setup was NOT completed; no code was exchanged.",
    });
  };
}
