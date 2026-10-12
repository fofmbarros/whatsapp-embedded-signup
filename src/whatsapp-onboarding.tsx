"use client";

import { useEffect, useRef, useState } from "react";
import { claimSignupAttempt, loadFacebookSdk } from "./facebook-sdk.js";
import type { FacebookSdk } from "./facebook-sdk.js";
import { createSignupAttempt } from "./signup.js";
import type { WhatsAppOnboardingProps } from "./types.js";

/**
 * Provides Meta WhatsApp Embedded Signup controls and Facebook SDK loading.
 *
 * Browser initialization starts after mount, so the component can be imported
 * during server rendering. Only one signup attempt may be active per package
 * instance. Your backend is responsible for exchanging the authorization code
 * and completing account setup; never pass app secrets or access tokens here.
 *
 * @param props - Public Meta configuration, callbacks, and a render function.
 * @returns Consumer-rendered UI. Events and presentation are owned by the consumer.
 * @example
 * ```tsx
 * <WhatsAppOnboarding
 *   appId="123"
 *   configId="456"
 *   onSuccess={async result => {
 *     await saveSignupOnServer(result);
 *   }}
 * >
 *   {({ start, isReady, isBusy }) => (
 *     <button type="button" onClick={start} disabled={!isReady || isBusy}>Connect WhatsApp</button>
 *   )}
 * </WhatsAppOnboarding>
 * ```
 */
export function WhatsAppOnboarding(props: WhatsAppOnboardingProps) {
  const {
    appId,
    configId,
    graphApiVersion = "v25.0",
    embeddedSignupVersion = "v4",
    signupMode = "coexistence",
  } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const [sdk, setSdk] = useState<FacebookSdk>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const cleanupAttempt = useRef<(() => void) | undefined>(undefined);
  const mounted = useRef(false);

  const reportError = (cause: unknown) => {
    if (!mounted.current) return;
    const failure = cause instanceof Error ? cause : new Error("WhatsApp onboarding failed");
    try {
      callbacks.current.onError?.(failure);
    } catch {
      // Error handlers must not interrupt lifecycle cleanup.
    }
  };

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    setSdk(undefined);
    setLoading(true);
    setBusy(false);
    loadFacebookSdk(appId, graphApiVersion).then(
      (loaded) => {
        if (!disposed) {
          setSdk(loaded);
          setLoading(false);
        }
      },
      (cause) => {
        if (!disposed) {
          setLoading(false);
          reportError(cause);
        }
      },
    );
    return () => {
      disposed = true;
      mounted.current = false;
      cleanupAttempt.current?.();
    };
  }, [appId, graphApiVersion]);

  const ready = Boolean(sdk);
  useEffect(() => {
    try {
      callbacks.current.onStateChange?.({ isLoading: loading, isReady: ready, isBusy: busy });
    } catch (cause) {
      reportError(cause);
    }
  }, [loading, ready, busy]);

  const start = () => {
    if (!mounted.current || !sdk || busy || cleanupAttempt.current) return;
    if (embeddedSignupVersion !== "v4" && embeddedSignupVersion !== "v4-public-preview") {
      reportError(
        new Error(
          "Supported Embedded Signup versions are v4 and v4-public-preview. Use a v4 Meta login configuration",
        ),
      );
      return;
    }
    if (!/^\d+$/.test(configId)) {
      reportError(new Error("Provide a numeric embedded signup configuration ID"));
      return;
    }
    const release = claimSignupAttempt();
    if (!release) {
      reportError(new Error("WhatsApp signup is already in progress in another component"));
      return;
    }
    setBusy(true);
    let loginFinished = false;
    const settle = async (callback: () => void | Promise<void>) => {
      window.removeEventListener("message", receiveMessage);
      try {
        await callback();
      } catch (cause) {
        if (cleanupAttempt.current === cleanup) reportError(cause);
      } finally {
        if (cleanupAttempt.current === cleanup) {
          cleanup();
          if (mounted.current) setBusy(false);
        }
      }
    };
    const attempt = createSignupAttempt({
      onSuccess: (result) => {
        void settle(() => callbacks.current.onSuccess(result));
      },
      onCancel: (details) => {
        void settle(() => callbacks.current.onCancel?.(details));
      },
      onError: (cause) => {
        void settle(() => reportError(cause));
      },
    });
    const receiveMessage = (event: MessageEvent) => attempt.receiveMessage(event);
    const cleanup = () => {
      attempt.dispose();
      window.removeEventListener("message", receiveMessage);
      // The SDK does not expose the popup handle. Keep ownership until its login callback.
      if (loginFinished) release();
      if (cleanupAttempt.current === cleanup) cleanupAttempt.current = undefined;
    };
    cleanupAttempt.current = cleanup;
    window.addEventListener("message", receiveMessage);
    try {
      sdk.login(
        (response) => {
          loginFinished = true;
          if (cleanupAttempt.current !== cleanup) {
            release();
            return;
          }
          attempt.receiveLogin(response);
        },
        {
          config_id: configId,
          response_type: "code",
          override_default_response_type: true,
          extras: {
            setup: props.setup ?? {},
            // Stable v4 is selected by the Meta login configuration, not extras.version.
            ...(embeddedSignupVersion === "v4-public-preview"
              ? { version: embeddedSignupVersion }
              : {}),
            ...(signupMode === "coexistence"
              ? { featureType: "whatsapp_business_app_onboarding" }
              : {}),
          },
        },
      );
    } catch (cause) {
      loginFinished = true;
      cleanup();
      setBusy(false);
      reportError(cause);
    }
  };

  return props.children({ start, isLoading: loading, isReady: ready, isBusy: busy });
}
