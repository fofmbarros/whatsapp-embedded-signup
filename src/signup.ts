import type { SignupCancel, SignupResult } from "./types.js";

type Completion = Omit<SignupResult, "code" | "mode"> &
  (
    | { mode: "FINISH"; phone_number_id: string }
    | { mode: "FINISH_ONLY_WABA" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING" }
  );

/**
 * Joins the SDK login response and trusted-origin completion message in either order.
 * Settles at most once and clears stored authorization data on settlement or disposal.
 * This helper does not install message listeners or open the signup popup.
 *
 * @param options - Settlement callbacks and the deadline for the second result.
 * @returns Handlers for login/message input and silent disposal of the attempt.
 */
export function createSignupAttempt(options: {
  /** Receives the validated result once both halves of signup have arrived. */
  onSuccess(result: SignupResult): void;
  /** Receives cancellation, missing-code, or incomplete-result details. */
  onCancel(details: SignupCancel): void;
  /** Receives Meta error events or invalid completion-data errors. */
  onError(error: Error): void;
  /**
   * Milliseconds to wait for the second result after receiving the first.
   * Does not limit how long the user may interact with the popup.
   * @defaultValue 10000
   */
  timeoutMs?: number;
}) {
  let code: string | undefined;
  let completion: Completion | undefined;
  let terminal = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const dispose = () => {
    terminal = true;
    clearTimeout(timer);
    code = undefined;
    completion = undefined;
  };
  const fail = (error: Error) => {
    dispose();
    options.onError(error);
  };
  const cancel = (details: SignupCancel) => {
    dispose();
    options.onCancel(details);
  };
  const join = () => {
    if (code && completion) {
      const result = { ...completion, code };
      dispose();
      options.onSuccess(result);
    } else if (!timer) {
      timer = setTimeout(() => cancel({ reason: "incomplete" }), options.timeoutMs ?? 10_000);
    }
  };

  return {
    /** Silently ends the attempt, clears its timer/data, and ignores future input. */
    dispose,
    /** Accepts the untrusted SDK login response and extracts its authorization code. */
    receiveLogin(response: unknown) {
      if (terminal) return;
      if (
        typeof response === "object" &&
        response !== null &&
        !Array.isArray(response) &&
        "authResponse" in response &&
        typeof response.authResponse === "object" &&
        response.authResponse !== null &&
        !Array.isArray(response.authResponse) &&
        "code" in response.authResponse &&
        typeof response.authResponse.code === "string" &&
        response.authResponse.code.trim()
      ) {
        code = response.authResponse.code;
        join();
      } else {
        cancel({ reason: "missing_code" });
      }
    },
    /** Validates Facebook-origin JSON signup messages; unrelated traffic is ignored. */
    receiveMessage(event: { origin: string; data: unknown }) {
      if (
        terminal ||
        !["https://www.facebook.com", "https://facebook.com", "https://web.facebook.com"].includes(
          event.origin,
        ) ||
        typeof event.data !== "string"
      )
        return;
      let message: unknown;
      try {
        message = JSON.parse(event.data);
      } catch {
        // Facebook also sends non-JSON SDK traffic on this channel.
        return;
      }
      if (
        typeof message !== "object" ||
        message === null ||
        Array.isArray(message) ||
        !("type" in message) ||
        message.type !== "WA_EMBEDDED_SIGNUP" ||
        !("event" in message)
      )
        return;
      if (message.event === "CANCEL") {
        const data = "data" in message ? message.data : undefined;
        const currentStep =
          typeof data === "object" &&
          data !== null &&
          !Array.isArray(data) &&
          "current_step" in data &&
          typeof data.current_step === "string"
            ? data.current_step
            : undefined;
        cancel({ reason: "cancelled", ...(currentStep ? { currentStep } : {}) });
        return;
      }
      if (message.event === "ERROR") {
        fail(new Error("Meta reported a signup error"));
        return;
      }
      if (
        message.event !== "FINISH" &&
        message.event !== "FINISH_ONLY_WABA" &&
        message.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      )
        return;
      const data = "data" in message ? message.data : undefined;
      if (
        typeof data !== "object" ||
        data === null ||
        Array.isArray(data) ||
        !("waba_id" in data) ||
        typeof data.waba_id !== "string" ||
        !/^\d+$/.test(data.waba_id)
      ) {
        fail(new Error("Invalid WhatsApp completion data"));
        return;
      }
      const phoneNumberId = "phone_number_id" in data ? data.phone_number_id : undefined;
      const businessId = "business_id" in data ? data.business_id : undefined;
      if (
        (message.event === "FINISH" && phoneNumberId === undefined) ||
        (phoneNumberId !== undefined &&
          (typeof phoneNumberId !== "string" || !/^\d+$/.test(phoneNumberId))) ||
        (businessId !== undefined && (typeof businessId !== "string" || !/^\d+$/.test(businessId)))
      ) {
        fail(new Error("Invalid WhatsApp completion data"));
        return;
      }
      const identifiers = {
        waba_id: data.waba_id,
        ...(phoneNumberId !== undefined ? { phone_number_id: phoneNumberId } : {}),
        ...(businessId !== undefined ? { business_id: businessId } : {}),
      };
      if (message.event === "FINISH" && phoneNumberId !== undefined) {
        completion = { ...identifiers, mode: "FINISH", phone_number_id: phoneNumberId };
      } else if (
        message.event === "FINISH_ONLY_WABA" ||
        message.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ) {
        completion = { ...identifiers, mode: message.event };
      }
      join();
    },
  };
}
