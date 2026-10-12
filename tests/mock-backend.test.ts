import { expect, test } from "bun:test";
import { createMockHandler } from "../scripts/mock-backend";

const origin = "https://example.test";
const handle = createMockHandler(origin);

test("mock backend supports credentialed CORS preflight", async () => {
  const response = await handle(
    new Request("https://backend.test/api/onboarding", {
      method: "OPTIONS",
      headers: { Origin: origin },
    }),
  );
  expect(response.status).toBe(204);
  expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(response.headers.get("Access-Control-Allow-Credentials")).toBe("true");
});

test("mock backend returns test metadata without echoing the authorization code", async () => {
  const response = await handle(
    new Request("https://backend.test/api/onboarding", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ code: "sensitive-test-code" }),
    }),
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.text();
  expect(JSON.parse(body).testOnly).toBe(true);
  expect(body).not.toContain("sensitive-test-code");
});

test("mock backend rejects unapproved origins and malformed JSON", async () => {
  const denied = await handle(
    new Request("https://backend.test/api/onboarding", {
      method: "POST",
      headers: { Origin: "https://untrusted.test" },
    }),
  );
  expect(denied.status).toBe(403);
  expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
  const malformed = await handle(
    new Request("https://backend.test/api/onboarding", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "not-json",
    }),
  );
  expect(malformed.status).toBe(400);
});
