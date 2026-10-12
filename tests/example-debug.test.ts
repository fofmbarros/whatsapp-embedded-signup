import { expect, test } from "bun:test";
import { redactCredentials } from "../example/src/debug";

test("example diagnostics redact nested credentials without mutating the response", () => {
  const response = {
    authResponse: { code: "secret-code", accessToken: "secret-token" },
    event: "FINISH",
    data: { waba_id: "123", error_code: "456" },
    nested: [{ access_token: "another-token", appSecret: "secret" }],
  };
  expect(redactCredentials(response)).toEqual({
    authResponse: { code: "[REDACTED]", accessToken: "[REDACTED]" },
    event: "FINISH",
    data: { waba_id: "123", error_code: "456" },
    nested: [{ access_token: "[REDACTED]", appSecret: "[REDACTED]" }],
  });
  expect(response.authResponse.code).toBe("secret-code");
});
