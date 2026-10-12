import type { Plugin } from "vite";
import { createMockHandler } from "../scripts/mock-backend";

/** Serve the test backend in the same process and on the same origin as the UI. */
export function mockBackend(): Plugin {
  return {
    name: "example-mock-backend",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split("?")[0] !== "/api/onboarding") return next();
        response.setHeader("Cache-Control", "no-store");
        try {
          const origin = `${server.config.server.https ? "https" : "http"}://${request.headers.host}`;
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > 16 * 1024) {
              response.writeHead(413, { "Content-Type": "application/json" });
              response.end(JSON.stringify({ error: "Request body too large" }));
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(request.headers)) {
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          }
          const method = request.method ?? "GET";
          const result = await createMockHandler(origin)(
            new Request(new URL(request.url, origin), {
              method,
              headers,
              body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
            }),
          );
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(await result.text());
        } catch {
          response.writeHead(500, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ error: "Request failed" }));
        }
      });
    },
  };
}
