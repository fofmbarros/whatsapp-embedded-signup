import { describe, expect, test } from "bun:test";
import { createSignupAttempt } from "../src/signup";

function message(
  event: string,
  data: unknown = { waba_id: "123" },
  origin = "https://www.facebook.com",
) {
  return { origin, data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data }) };
}
function capture(timeoutMs = 10_000) {
  const results: unknown[] = [];
  const cancellations: unknown[] = [];
  const errors: Error[] = [];
  const attempt = createSignupAttempt({
    onSuccess: (result) => {
      results.push(result);
    },
    onCancel: (reason) => {
      cancellations.push(reason);
    },
    onError: (error) => {
      errors.push(error);
    },
    timeoutMs,
  });
  return { ...attempt, results, cancellations, errors };
}

describe("signup result joining", () => {
  for (const codeFirst of [true, false]) {
    test(`coexistence WABA-only completion, code first: ${codeFirst}`, () => {
      const attempt = capture();
      const event = message("FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING");
      if (codeFirst) {
        attempt.receiveLogin({ authResponse: { code: "code" } });
        attempt.receiveMessage(event);
      } else {
        attempt.receiveMessage(event);
        attempt.receiveLogin({ authResponse: { code: "code" } });
      }
      attempt.receiveMessage(event);
      attempt.receiveLogin({ authResponse: { code: "code" } });
      expect(attempt.results).toEqual([
        { code: "code", mode: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", waba_id: "123" },
      ]);
      expect(attempt.errors).toEqual([]);
      attempt.dispose();
    });
  }
  test("standard completion retains only validated identifiers", () => {
    const attempt = capture();
    attempt.receiveMessage(
      message("FINISH", {
        waba_id: "123",
        phone_number_id: "456",
        business_id: "789",
        token: "untrusted",
      }),
    );
    attempt.receiveLogin({ authResponse: { code: "code" } });
    expect(attempt.results).toEqual([
      { code: "code", mode: "FINISH", waba_id: "123", phone_number_id: "456", business_id: "789" },
    ]);
  });
  test("account-only completion does not fabricate a phone", () => {
    const attempt = capture();
    attempt.receiveLogin({ authResponse: { code: "code" } });
    attempt.receiveMessage(message("FINISH_ONLY_WABA"));
    expect(attempt.results).toEqual([{ code: "code", mode: "FINISH_ONLY_WABA", waba_id: "123" }]);
  });
});

test("untrusted origins and unrelated payloads cannot complete an attempt", () => {
  const attempt = capture();
  attempt.receiveLogin({ authResponse: { code: "code" } });
  for (const origin of [
    "https://notfacebook.com",
    "https://facebook.com.attacker.test",
    "http://www.facebook.com",
    "https://www.facebook.com:8443",
    "null",
  ]) {
    attempt.receiveMessage(message("FINISH_ONLY_WABA", undefined, origin));
  }
  for (const data of [
    "cb=123",
    "not-json",
    "null",
    JSON.stringify({ type: "OTHER", event: "FINISH" }),
  ]) {
    attempt.receiveMessage({ origin: "https://www.facebook.com", data });
  }
  expect(attempt.results).toEqual([]);
  expect(attempt.errors).toEqual([]);
  attempt.receiveMessage(message("FINISH_ONLY_WABA"));
  expect(attempt.results).toEqual([{ code: "code", mode: "FINISH_ONLY_WABA", waba_id: "123" }]);
});

test("invalid completion data reports an error instead of submitting", () => {
  for (const data of [null, {}, { waba_id: "123" }, { waba_id: "123", phone_number_id: 456 }]) {
    const attempt = capture();
    attempt.receiveMessage(message("FINISH", data));
    attempt.receiveLogin({ authResponse: { code: "code" } });
    expect(attempt.results).toEqual([]);
    expect(attempt.errors[0]?.message).toContain("completion");
    attempt.dispose();
  }
});

test("cancel and missing code terminate without later completion", () => {
  const attempt = capture();
  attempt.receiveMessage(message("CANCEL", { current_step: "VERIFY_PHONE" }));
  attempt.receiveLogin({ authResponse: { code: "late" } });
  expect(attempt.cancellations).toEqual([{ reason: "cancelled", currentStep: "VERIFY_PHONE" }]);
  expect(attempt.results).toEqual([]);
  const missing = capture();
  missing.receiveLogin({});
  expect(missing.cancellations).toEqual([{ reason: "missing_code" }]);
});

test("Meta error events surface without exposing their payload", () => {
  const attempt = capture();
  attempt.receiveMessage(message("ERROR", { error_message: "private payload", error_id: "123" }));
  expect(attempt.errors[0]?.message).toBe("Meta reported a signup error");
  expect(attempt.results).toEqual([]);
});

test("disposed attempts ignore both event channels", () => {
  const attempt = capture();
  attempt.dispose();
  attempt.receiveMessage(message("FINISH_ONLY_WABA"));
  attempt.receiveLogin({ authResponse: { code: "late" } });
  expect(attempt.results).toEqual([]);
  expect(attempt.cancellations).toEqual([]);
});

test("join deadline reports incomplete and late events cannot submit", async () => {
  const results: unknown[] = [];
  const cancelled = Promise.withResolvers<unknown>();
  // This integration check awaits the platform timer's event, not a guessed sleep.
  const attempt = createSignupAttempt({
    onSuccess: (result) => {
      results.push(result);
    },
    onCancel: cancelled.resolve,
    onError: cancelled.reject,
    timeoutMs: 1,
  });
  attempt.receiveLogin({ authResponse: { code: "code" } });
  expect(await cancelled.promise).toEqual({ reason: "incomplete" });
  attempt.receiveMessage(message("FINISH_ONLY_WABA"));
  expect(results).toEqual([]);
});
