import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WhatsAppOnboarding } from "@fofmbarros/whatsapp-embedded-signup";
import type { WhatsAppOnboardingState } from "@fofmbarros/whatsapp-embedded-signup";
import { debugLog } from "./debug";
import "./style.css";

function App() {
  const [appId, setAppId] = useState("");
  const [configId, setConfigId] = useState("");
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState<unknown>();
  const [credentials, setCredentials] = useState<{ appId: string; configId: string }>();
  const [onboarding, setOnboarding] = useState<WhatsAppOnboardingState>({
    isLoading: true,
    isReady: false,
    isBusy: false,
  });
  const [waitingForMeta, setWaitingForMeta] = useState(false);
  const [signupMessages, setSignupMessages] = useState<unknown[]>([]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const receiveMessage = (event: MessageEvent) => {
      let message: unknown = event.data;
      if (typeof message === "string") {
        try {
          message = JSON.parse(message);
        } catch {
          return;
        }
      }
      if (
        typeof message !== "object" ||
        message === null ||
        !("type" in message) ||
        message.type !== "WA_EMBEDDED_SIGNUP"
      )
        return;
      debugLog("Meta message", { origin: event.origin, message });
      // Display metadata only; messages are diagnostic, not trusted signup results.
      const summary = {
        origin: event.origin,
        event: "event" in message ? message.event : undefined,
        fields:
          "data" in message && typeof message.data === "object" && message.data !== null
            ? Object.keys(message.data)
            : [],
      };
      setSignupMessages((previous) => [...previous.slice(-19), summary]);
    };
    window.addEventListener("message", receiveMessage);
    return () => window.removeEventListener("message", receiveMessage);
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV || !onboarding.isReady) return;
    const fb = Reflect.get(window, "FB") as
      | { login(callback: (response: unknown) => void, options: unknown): void }
      | undefined;
    if (!fb || typeof fb.login !== "function") return;
    const originalLogin = fb.login;
    const diagnosticLogin: typeof originalLogin = (callback, options) => {
      debugLog("FB.login launch", options);
      originalLogin.call(
        fb,
        (response) => {
          debugLog("FB.login callback", response);
          callback(response);
        },
        options,
      );
    };
    fb.login = diagnosticLogin;
    return () => {
      if (fb.login === diagnosticLogin) fb.login = originalLogin;
    };
  }, [onboarding.isReady]);
  useEffect(() => {
    if (!onboarding.isBusy) return;
    const timeout = setTimeout(() => setWaitingForMeta(true), 15_000);
    return () => clearTimeout(timeout);
  }, [onboarding.isBusy]);
  return (
    <main>
      <h1>Connect WhatsApp</h1>
      <p>Meta Embedded Signup, without framework-specific dependencies.</p>
      <p>
        This example includes a test-only backend at /api/onboarding. It does not exchange codes or
        complete WhatsApp account setup. Enter only your public Meta IDs below, never app secrets or
        access tokens.
      </p>
      {location.protocol !== "https:" ? (
        <p>
          This page is using HTTP. For live Meta signup, open the example on an HTTPS origin allowed
          in your Meta app's Facebook Login for Business settings. Hosting only the backend on HTTPS
          is not enough.
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setCredentials({ appId, configId });
        }}
      >
        <label>
          Meta app ID
          <input
            required
            pattern="[0-9]+"
            value={appId}
            onChange={(event) => setAppId(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <label>
          Signup configuration ID
          <input
            required
            pattern="[0-9]+"
            value={configId}
            onChange={(event) => setConfigId(event.target.value)}
            inputMode="numeric"
          />
        </label>
        <button type="submit">Apply configuration</button>
      </form>
      {credentials ? (
        <WhatsAppOnboarding
          appId={credentials.appId}
          configId={credentials.configId}
          signupMode="standard"
          onStateChange={(state) => {
            debugLog("State", state);
            setOnboarding(state);
          }}
          onSuccess={async (result) => {
            debugLog("Joined signup result", result);
            setNotice("Sending signup result to the test backend…");
            const response = await fetch("/api/onboarding", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(result),
            });
            debugLog("Backend HTTP status", { status: response.status });
            if (!response.ok) throw new Error("Your backend rejected account setup");
            const metadata: unknown = await response.json();
            debugLog("Backend JSON", metadata);
            setConnection(metadata);
            setNotice(
              typeof metadata === "object" &&
                metadata !== null &&
                "testOnly" in metadata &&
                metadata.testOnly === true
                ? "Mock test completed — WhatsApp account setup was not performed"
                : "WhatsApp account connected",
            );
          }}
          onCancel={(details) => {
            debugLog("Signup cancellation/incomplete", details);
            setNotice(
              details.reason === "cancelled"
                ? "Signup cancelled"
                : details.reason === "missing_code"
                  ? "Meta returned no authorization code"
                  : "Signup incomplete — the authorization code and completion event did not both arrive within 10 seconds. Check the diagnostic logs.",
            );
          }}
          onError={(error) => {
            debugLog("Error", { message: error.message });
            setNotice(error.message);
          }}
        >
          {({ start }) => (
            <button
              onClick={() => {
                setNotice("");
                setWaitingForMeta(false);
                setSignupMessages([]);
                start();
              }}
              type="button"
              disabled={!onboarding.isReady || onboarding.isBusy}
              aria-busy={onboarding.isLoading || onboarding.isBusy}
            >
              {onboarding.isLoading
                ? "Loading Facebook SDK…"
                : onboarding.isBusy
                  ? "Waiting for Meta…"
                  : "Connect WhatsApp"}
            </button>
          )}
        </WhatsAppOnboarding>
      ) : (
        <p>Enter your public app ID and signup configuration ID to load the signup component.</p>
      )}
      <p role="status">{notice}</p>
      {waitingForMeta && onboarding.isBusy && !notice ? (
        <p role="status">
          Meta has not returned a result yet. If no signup window opened, check your browser's popup
          settings and your Meta app's allowed HTTPS origin and JavaScript SDK login settings.
          Reload this page before retrying. If a signup window is open, continue there instead.
        </p>
      ) : null}
      {connection !== undefined ? <pre>{JSON.stringify(connection, null, 2)}</pre> : null}
      {import.meta.env.DEV ? (
        <details>
          <summary>Signup message diagnostics ({signupMessages.length})</summary>
          <p>
            Untrusted message metadata only. Full development diagnostics are in the browser console
            under [WhatsApp example]; authorization codes and access tokens are redacted.
          </p>
          <pre>{JSON.stringify(signupMessages, null, 2)}</pre>
        </details>
      ) : null}
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("Example root element is missing");
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
