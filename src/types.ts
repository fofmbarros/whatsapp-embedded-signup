import type { ReactNode } from "react";

/**
 * Developer launch option, not a required customer-facing choice. `standard`
 * launches the default Meta flow without a coexistence feature override;
 * `coexistence` explicitly requests WhatsApp Business app onboarding.
 *
 * The public preview may select coexistence automatically regardless of this
 * preference. Use {@link SignupResult.mode} to determine the actual completion.
 */
export type SignupMode = "standard" | "coexistence";

/**
 * Supported Embedded Signup flow versions, independent of the Graph API version.
 * Both require a v4 Facebook Login for Business configuration. Stable `v4` is
 * selected by that configuration; `v4-public-preview` opts into the preview.
 */
export type EmbeddedSignupVersion = "v4" | "v4-public-preview";

/**
 * Business-information prefill passed to Meta as `extras.setup`.
 *
 * Prefill does not skip v4 screens or guarantee asset selection. All fields are
 * browser-visible; do not include credentials. Partial prefill is supported,
 * but the customer must still supply any required information.
 */
export type EmbeddedSignupSetup = {
  /** Suggested business portfolio and contact details. */
  business?: {
    /** Existing portfolio ID. Meta checks ownership and may use its existing details. */
    id?: string | null;
    /** Business name to prefill when creating a portfolio. */
    name?: string;
    /** Business contact email address. */
    email?: string;
    /** Business website URL, such as `https://example.com`. */
    website?: string;
    /** Business postal address. */
    address?: {
      /** Primary street address. */
      streetAddress1?: string;
      /** Additional address details, such as an apartment or suite. */
      streetAddress2?: string;
      /** City or locality. */
      city?: string;
      /** State, province, or region. */
      state?: string;
      /** ZIP or postal code. */
      zipPostal?: string;
      /** ISO 3166-1 alpha-2 country code, such as `PT`. */
      country?: string;
    };
    /** Business contact number, not a pre-verified WhatsApp number. */
    phone?: {
      /** Numeric country calling code, such as `351` for Portugal. */
      code: number;
      /** Contact phone number excluding the country calling code. */
      number: string;
    };
    /** UTC offset, such as `UTC+01:00`. */
    timezone?: string;
  };
};

/**
 * Validated completion data delivered after both Meta's authorization code and
 * Embedded Signup completion message arrive.
 *
 * Send this result to your authenticated backend to exchange the code and finish
 * account setup. Narrow on `mode` before using `phone_number_id`; the requested
 * {@link SignupMode} does not guarantee a particular completion mode.
 */
export type SignupResult = {
  /** One-use authorization code. Exchange promptly on your server; never log it. */
  code: string;
  /** Numeric WhatsApp Business Account (WABA) ID. */
  waba_id: string;
  /** Numeric business portfolio ID, present only when supplied by Meta. */
  business_id?: string;
} & (
  | {
      /** Standard completion. Your server must register the number for Cloud API. */
      mode: "FINISH";
      /** Numeric ID of the phone number to register for Cloud API. */
      phone_number_id: string;
    }
  | {
      /**
       * `FINISH_ONLY_WABA` completes account-only signup; add a phone separately.
       * `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` completes coexistence; do not
       * register the existing WhatsApp Business app number again.
       */
      mode: "FINISH_ONLY_WABA" | "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING";
      /** Numeric phone number ID, if supplied. Otherwise fetch authorized account metadata. */
      phone_number_id?: string;
    }
);

/** Details of a cancelled or incomplete signup attempt, delivered to `onCancel`. */
export type SignupCancel = {
  /**
   * `cancelled`: Meta sent a cancellation event.
   * `missing_code`: the login callback did not contain an authorization code.
   * `incomplete`: the code or completion message arrived, but its counterpart
   * did not arrive within 10 seconds. This is not a popup interaction timeout.
   */
  reason: "cancelled" | "missing_code" | "incomplete";
  /** Meta's `current_step` value, when included in a cancellation event. */
  currentStep?: string;
};

/** Lifecycle state for consumer-owned loading, disabled, and accessibility UI. */
export type WhatsAppOnboardingState = {
  /** Whether the Facebook SDK is loading or initializing. */
  isLoading: boolean;
  /** Whether this component has a loaded SDK. False after SDK loading fails. */
  isReady: boolean;
  /** Whether signup or an awaited success/cancellation callback is in progress. */
  isBusy: boolean;
};

/** Render-prop controls for consumer-owned UI and event handling. */
export type WhatsAppOnboardingControls = WhatsAppOnboardingState & {
  /**
   * Starts signup synchronously. Call directly from a user interaction to avoid
   * popup blocking. Calls before SDK readiness, during signup, or after unmount are ignored.
   */
  start(): void;
};

/** Configuration, lifecycle callbacks, and consumer-owned UI for `WhatsAppOnboarding`. */
export type WhatsAppOnboardingProps = {
  /** Numeric public Meta application ID. Use the same app and SDK version throughout the page. */
  appId: string;
  /** Numeric Facebook Login for Business configuration ID configured for Embedded Signup v4. */
  configId: string;
  /**
   * Graph API version used to initialize the Facebook SDK, in `vN.N` format.
   * Independent of `embeddedSignupVersion`; must match any host SDK configuration.
   * @defaultValue "v25.0"
   */
  graphApiVersion?: string;
  /**
   * Embedded Signup flow version. Setting `v4` does not upgrade an old Meta configuration.
   * @defaultValue "v4"
   */
  embeddedSignupVersion?: EmbeddedSignupVersion;
  /**
   * Developer launch option; customers do not need to select this before signup.
   * `standard` uses the default Meta flow; `coexistence` explicitly requests Business
   * app onboarding. The public preview may choose coexistence automatically;
   * inspect the returned result's `mode` for the actual flow.
   * @defaultValue "coexistence"
   */
  signupMode?: SignupMode;
  /**
   * Business-information prefill. Does not skip screens or pre-verify a WhatsApp number.
   * @defaultValue {}
   */
  setup?: EmbeddedSignupSetup;
  /**
   * Called once when both the authorization code and validated completion data arrive.
   * Finish account setup on your backend. A returned promise is awaited with the
   * trigger blocked; throws or rejections are forwarded to `onError`.
   */
  onSuccess(result: SignupResult): void | Promise<void>;
  /**
   * Called when signup is cancelled or incomplete. A returned promise is awaited
   * with the trigger blocked; throws or rejections are forwarded to `onError`.
   */
  onCancel?(details: SignupCancel): void | Promise<void>;
  /**
   * Synchronous error handler for SDK loading, signup, and consumer callback failures.
   * Error presentation is up to the consumer. Do not return a promise.
   */
  onError?(error: Error): void;
  /**
   * Synchronous notification on mount and lifecycle state changes. May repeat in Strict Mode.
   * Use `!isReady || isBusy` to disable your trigger, and `isLoading || isBusy`
   * for loading presentation. No disabled or ARIA state is injected into the child.
   * Throws are forwarded to `onError`. Do not return a promise.
   */
  onStateChange?(state: WhatsAppOnboardingState): void;
  /**
   * Render your UI using `start`, `isLoading`, `isReady`, and `isBusy`.
   * Choose the event that invokes `start`. No event handlers, disabled/ARIA props,
   * button defaults, or wrapper elements are injected. Consumers own accessibility
   * and decide whether to call `start` when their trigger is disabled or an event is prevented.
   */
  children(controls: WhatsAppOnboardingControls): ReactNode;
};
