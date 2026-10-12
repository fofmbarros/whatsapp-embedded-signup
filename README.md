# @fofmbarros/whatsapp-embedded-signup

A headless React component for [Meta WhatsApp Embedded Signup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation).

Connect WhatsApp Business accounts with a custom UI. The component loads the Facebook SDK, handles the signup flow, and returns an authorization code and account IDs for server-side setup.

- Supports React 18 and 19.
- Supports Cloud API signup, WhatsApp Business app coexistence, and account-only completion.
- No runtime dependencies beyond React, no CSS, and no wrapper elements.
- Safe to import during server-side rendering; the SDK initializes after mount.
- Includes TypeScript declarations.

## Installation

Install with your preferred package manager:

```sh
npm install @fofmbarros/whatsapp-embedded-signup
```

```sh
pnpm add @fofmbarros/whatsapp-embedded-signup
```

```sh
bun add @fofmbarros/whatsapp-embedded-signup
```

React 18 or 19 must be installed in the application.

## Quick start

```tsx
import { WhatsAppOnboarding } from "@fofmbarros/whatsapp-embedded-signup";

export function ConnectWhatsApp() {
  return (
    <WhatsAppOnboarding
      appId="YOUR_PUBLIC_META_APP_ID"
      configId="YOUR_PUBLIC_SIGNUP_CONFIGURATION_ID"
      signupMode="standard"
      onSuccess={async (result) => {
        const response = await fetch("/api/whatsapp/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(result),
        });
        if (!response.ok) throw new Error("Account setup failed");
      }}
      onError={(error) => console.error(error.message)}
    >
      {({ start, isLoading, isReady, isBusy }) => (
        <button type="button" onClick={start} disabled={!isReady || isBusy}>
          {isLoading || isBusy ? "Connecting…" : "Connect WhatsApp"}
        </button>
      )}
    </WhatsAppOnboarding>
  );
}
```

Replace the placeholders with numeric Meta IDs. The `/api/whatsapp/onboarding` endpoint must be implemented by the application; this package does not provide a production backend.

In Next.js App Router, add `"use client"` to the file containing this component.

## API

### Component props

| Prop                    | Required | Description                                                                                                                        |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `appId`                 | Yes      | Public Meta app ID.                                                                                                                |
| `configId`              | Yes      | Facebook Login for Business configuration ID for Embedded Signup v4.                                                               |
| `onSuccess`             | Yes      | Receives `SignupResult`. May return a promise.                                                                                     |
| `children`              | Yes      | Render function receiving `{ start, isLoading, isReady, isBusy }`.                                                                 |
| `signupMode`            | No       | `standard` uses the default Meta flow; `coexistence` explicitly requests WhatsApp Business app onboarding. Default: `coexistence`. |
| `embeddedSignupVersion` | No       | `v4` (default) or `v4-public-preview`. Legacy v2/v3 are not supported.                                                             |
| `graphApiVersion`       | No       | Facebook SDK Graph API version. Default: `v25.0`.                                                                                  |
| `setup`                 | No       | Business-information prefill, such as `{ business: { name: "Example", address: { country: "PT" } } }`.                             |
| `onCancel`              | No       | Receives `{ reason, currentStep? }`. Reasons: `cancelled`, `missing_code`, or `incomplete`. May return a promise.                  |
| `onError`               | No       | Synchronous handler receiving an `Error`.                                                                                          |
| `onStateChange`         | No       | Synchronous notification with `{ isLoading, isReady, isBusy }` on mount and state changes.                                         |

### Render controls

| Control     | Description                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `start()`   | Launches signup. Call directly from a user interaction to avoid popup blockers. Ignored before SDK readiness or while busy. |
| `isLoading` | The Facebook SDK is loading or initializing.                                                                                |
| `isReady`   | The SDK is ready to launch signup.                                                                                          |
| `isBusy`    | Signup or an awaited success/cancellation callback is in progress.                                                          |

The component does not inject event handlers, styling, disabled state, or accessibility attributes. These are controlled by the rendered UI. Callback errors are forwarded to `onError`.

Use one Meta app and SDK version per page. Only one signup can be active at a time. If SDK loading fails, reload the page to retry.

### Signup result

Every successful result includes `code`, `waba_id`, and `mode`. `business_id` is optional; `phone_number_id` is required only for `FINISH`.

| `mode`                                    | Meaning                            | Backend action                                                                                                     |
| ----------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `FINISH`                                  | Standard Cloud API signup.         | Subscribe the WABA to webhooks and register `phone_number_id` for Cloud API using a securely stored six-digit PIN. |
| `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` | WhatsApp Business app coexistence. | Complete coexistence setup and fetch phone metadata if needed. Do not register the existing app number again.      |
| `FINISH_ONLY_WABA`                        | Account-only completion.           | Complete account setup; add a phone separately before messaging.                                                   |

Always determine backend setup from the returned `mode`, not `signupMode`. The public preview can select coexistence automatically when a customer enters a WhatsApp Business app number, including when `signupMode="standard"`.

The package exports `SignupResult`, `SignupCancel`, `SignupMode`, `EmbeddedSignupVersion`, `EmbeddedSignupSetup`, `WhatsAppOnboardingProps`, `WhatsAppOnboardingState`, and `WhatsAppOnboardingControls`. See the [type definitions](https://github.com/fofmbarros/whatsapp-embedded-signup/blob/main/src/types.ts) for full contracts and prefill fields. Prefill does not skip screens or pre-verify a WhatsApp number.

## Meta configuration and backend requirements

1. Configure an eligible Meta business app with WhatsApp, Facebook Login for Business, and the required permissions and approvals.
2. Create a **v4 Embedded Signup** login configuration and pass its ID as `configId`. Setting `embeddedSignupVersion` does not upgrade an older configuration; the signup version is independent of the Graph API version.
3. Configure allowed HTTPS domains, OAuth settings, and webhook callbacks and subscriptions.
4. Implement an authenticated, CSRF-protected backend endpoint that validates tenant authorization, promptly exchanges the one-use code, securely stores the token, verifies access to the returned account, and completes setup according to `result.mode`.

Keep app secrets and access tokens on the server. Never log authorization codes or tokens, and do not retry a one-use code exchange. Persist the token before subsequent setup steps so those steps can be resumed after a failure.

For Meta-specific requirements, see:

- [Embedded Signup implementation](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/implementation)
- [Tech Provider setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider)
- [WhatsApp Business app coexistence](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
- [Signup versions](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/versions)
- [Pre-filled data](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/pre-filled-data)

## Example

The [example application](https://github.com/fofmbarros/whatsapp-embedded-signup/tree/main/example) demonstrates a custom signup UI and development diagnostics. Its mock backend is for testing only: it does not exchange authorization codes or complete WhatsApp account setup.

> **Note:** Running the example locally requires Bun.

## License

[MIT](LICENSE).
