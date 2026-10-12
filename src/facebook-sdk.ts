import type { EmbeddedSignupSetup } from "./types.js";

/** Internal subset of the browser Facebook SDK used by Embedded Signup. */
export type FacebookSdk = {
  /** Initializes an SDK that has not already been configured by the host page. */
  init(options: {
    appId: string;
    version: string;
    cookie: boolean;
    xfbml: boolean;
    autoLogAppEvents: boolean;
  }): void;
  /** Opens Embedded Signup and delivers the untrusted login response for validation. */
  login(
    callback: (response: unknown) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: true;
      extras: {
        setup: EmbeddedSignupSetup;
        version?: "v4-public-preview";
        featureType?: "whatsapp_business_app_onboarding";
      };
    },
  ): void;
  /** Returns the host SDK's app ID, allowing safe reuse when it matches. */
  getAppId?(): string | null;
};

function isSdk(value: unknown): value is FacebookSdk {
  return (
    typeof value === "object" &&
    value !== null &&
    // sdk.js publishes a queueing bootstrap facade before loading the real SDK.
    // Holding that facade after replacement silently queues login calls forever.
    !("__buffer" in value) &&
    "init" in value &&
    typeof value.init === "function" &&
    "login" in value &&
    typeof value.login === "function" &&
    (!("getAppId" in value) || typeof value.getAppId === "function")
  );
}

let loaded: { appId: string; version: string; promise: Promise<FacebookSdk> } | undefined;
let activeAttempt: symbol | undefined;

/**
 * Reserves the single active signup slot for this package instance.
 * @returns An idempotent release function, or `undefined` if another attempt owns the slot.
 */
export function claimSignupAttempt(): (() => void) | undefined {
  if (activeAttempt) return;
  const owner = Symbol();
  activeAttempt = owner;
  return () => {
    if (activeAttempt === owner) activeAttempt = undefined;
  };
}

/**
 * Loads or safely reuses the browser Facebook SDK for a single app/version pair.
 * Concurrent matching calls share a promise; failed loads clear the cached promise.
 * Requires browser globals and is called only after the component mounts.
 *
 * @param appId - Numeric public Meta application ID.
 * @param version - Graph API version in `vN.N` format.
 * @returns The initialized SDK. Rejects on invalid or conflicting configuration,
 * load/initialization failure, or a 15-second initialization timeout.
 */
export function loadFacebookSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (!/^\d+$/.test(appId) || !/^v\d+\.\d+$/.test(version)) {
    return Promise.reject(
      new Error("Provide a numeric Meta app ID and a Graph API version such as v25.0"),
    );
  }
  if (loaded) {
    return loaded.appId === appId && loaded.version === version
      ? loaded.promise
      : Promise.reject(
          new Error("The Facebook SDK is already configured for a different app or version"),
        );
  }
  const existing: unknown = Reflect.get(window, "FB");
  const previousInit: unknown = Reflect.get(window, "fbAsyncInit");
  const promise = new Promise<FacebookSdk>((resolve, reject) => {
    let settled = false;
    let script: HTMLScriptElement | undefined;
    let createdScript = false;
    const cleanup = () => {
      clearTimeout(timeout);
      script?.removeEventListener("error", onError);
      script?.removeEventListener("load", initialize);
      if (Reflect.get(window, "fbAsyncInit") === onReady) {
        if (previousInit === undefined) Reflect.deleteProperty(window, "fbAsyncInit");
        else Reflect.set(window, "fbAsyncInit", previousInit);
      }
    };
    const finish = (error?: Error, sdk?: FacebookSdk) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (createdScript) script?.remove();
        reject(error);
      } else if (sdk) resolve(sdk);
    };
    const onError = () => finish(new Error("Failed to load the Facebook SDK"));
    const initialize = () => {
      if (settled) return;
      try {
        const sdk: unknown = Reflect.get(window, "FB");
        if (!isSdk(sdk)) return;
        const currentApp = sdk.getAppId?.();
        if (currentApp && currentApp !== appId) {
          finish(new Error("The existing Facebook SDK belongs to a different app"));
          return;
        }
        if (!currentApp)
          sdk.init({ appId, version, cookie: true, xfbml: false, autoLogAppEvents: false });
        finish(undefined, sdk);
      } catch (error) {
        finish(error instanceof Error ? error : new Error("Facebook SDK initialization failed"));
      }
    };
    const onReady = () => {
      if (settled) return;
      try {
        if (typeof previousInit === "function") previousInit();
        initialize();
      } catch (error) {
        finish(
          error instanceof Error ? error : new Error("The host Facebook SDK initializer failed"),
        );
      }
    };
    const timeout = setTimeout(
      () => finish(new Error("Facebook SDK initialization timed out")),
      15_000,
    );
    if (isSdk(existing)) {
      if (!existing.getAppId) finish(new Error("Cannot verify the existing Facebook SDK app ID"));
      else initialize();
      return;
    }
    Reflect.set(window, "fbAsyncInit", onReady);
    script =
      document.querySelector<HTMLScriptElement>(
        'script[src="https://connect.facebook.net/en_US/sdk.js"]',
      ) ?? undefined;
    if (!script) {
      script = document.createElement("script");
      createdScript = true;
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.addEventListener("error", onError);
      script.addEventListener("load", initialize);
      document.head.appendChild(script);
    } else {
      script.addEventListener("error", onError);
      script.addEventListener("load", initialize);
    }
  });
  const ready = promise.catch((error) => {
    if (loaded?.promise === ready) loaded = undefined;
    throw error;
  });
  loaded = { appId, version, promise: ready };
  return ready;
}
