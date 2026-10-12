import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import config from "../example/vite.config";
import { mockBackend } from "../example/mock-backend";

test("example config always enables HTTPS", () => {
  expect(config.server?.https).toBeTruthy();
});

test("example serves its UI and fixed, same-origin test backend together", async () => {
  // Use HTTP in this test: Bun's HTTP/2 server does not support Vite's HTTP/1 fallback.
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL("../example", import.meta.url)),
    plugins: [mockBackend()],
    server: { host: "127.0.0.1", port: 0, strictPort: false },
  });
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("Missing example server address");
    const origin = `http://127.0.0.1:${address.port}`;
    const send = (body: string, requestOrigin = origin) =>
      fetch(`${origin}/api/onboarding`, {
        method: "POST",
        headers: { Origin: requestOrigin, "Content-Type": "application/json" },
        body,
      });

    const page = await fetch(origin);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('id="root"');
    const result = await send(JSON.stringify({ code: "sensitive-test-code" }));
    expect(result.status).toBe(200);
    const metadata = await result.text();
    expect(JSON.parse(metadata).testOnly).toBe(true);
    expect(metadata).not.toContain("sensitive-test-code");
    expect((await send("{}", "https://untrusted.test")).status).toBe(403);
    expect((await send("not-json")).status).toBe(400);
    expect((await send(JSON.stringify({ data: "x".repeat(16 * 1024) }))).status).toBe(413);
  } finally {
    await server.close();
  }
});
