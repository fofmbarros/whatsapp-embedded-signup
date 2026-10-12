import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  act,
  cloneElement,
  createRef,
  StrictMode,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type MouseEvent,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import type { WhatsAppOnboardingProps } from "../src/types";
import type { FacebookSdk } from "../src/facebook-sdk";
import { loadFacebookSdk } from "../src/facebook-sdk";
import { WhatsAppOnboarding } from "../src/whatsapp-onboarding";
import type { EmbeddedSignupSetup, WhatsAppOnboardingState } from "../src/index";

const dom = new Window({ url: "http://localhost:5173" });
Object.assign(globalThis, {
  window: dom,
  document: dom.document,
  navigator: dom.navigator,
  Event: dom.Event,
  KeyboardEvent: dom.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
});
let loginCallback: ((value: unknown) => void) | undefined;
let loginOptions: Parameters<FacebookSdk["login"]>[1] | undefined;
let roots: Root[] = [];
let initCount = 0;
const sdk: FacebookSdk = {
  init: () => {
    initCount += 1;
  },
  getAppId: () => "123",
  login: (callback, options) => {
    loginCallback = callback;
    loginOptions = options;
  },
};
Reflect.set(dom, "FB", sdk);

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots = [];
  dom.document.body.innerHTML = "";
  loginCallback = undefined;
  loginOptions = undefined;
});

// These test consumers choose click activation; the package does not wire events.
async function mount(
  props: Omit<Partial<WhatsAppOnboardingProps>, "children"> & {
    children?: WhatsAppOnboardingProps["children"] | ReactElement<HTMLAttributes<HTMLElement>>;
  } = {},
  count = 1,
) {
  const { children = <button type="button">Connect WhatsApp</button>, ...config } = props;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        {Array.from({ length: count }, (_, index) => (
          <WhatsAppOnboarding
            key={index}
            appId="123"
            configId="456"
            onSuccess={() => {}}
            {...config}
            children={
              typeof children === "function"
                ? children
                : ({ start }) =>
                    cloneElement(children, {
                      onClick: (event: MouseEvent<HTMLElement>) => {
                        children.props.onClick?.(event);
                        if (
                          !event.defaultPrevented &&
                          children.props["aria-disabled"] !== true &&
                          children.props["aria-disabled"] !== "true"
                        )
                          start();
                      },
                    })
            }
          />
        ))}
      </StrictMode>,
    );
  });
  return host;
}
function finish(
  event = "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
  origin = "https://www.facebook.com",
) {
  dom.dispatchEvent(
    new dom.MessageEvent("message", {
      origin,
      data: JSON.stringify({ type: "WA_EMBEDDED_SIGNUP", event, data: { waba_id: "789" } }),
    }),
  );
}

test("SDK load failure is reported without error UI and a fresh mount can use a ready SDK", async () => {
  const errors: Error[] = [];
  const states: WhatsAppOnboardingState[] = [];
  Reflect.deleteProperty(dom, "FB");
  const host = await mount({
    onStateChange: (state) => {
      states.push(state);
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  const script = document.querySelector('script[src="https://connect.facebook.net/en_US/sdk.js"]');
  await act(async () => {
    script?.dispatchEvent(new Event("error"));
  });
  expect(errors[0]?.message).toContain("Failed to load");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("button")?.disabled).toBe(false);
  expect(states[0]).toEqual({ isLoading: true, isReady: false, isBusy: false });
  expect(states.at(-1)).toEqual({ isLoading: false, isReady: false, isBusy: false });
  expect(host.querySelector("button")?.getAttribute("aria-busy")).toBeNull();
  Reflect.set(dom, "FB", { init: sdk.init, login: sdk.login });
  await expect(loadFacebookSdk("123", "v25.0")).rejects.toThrow("Cannot verify");
  const bufferedCalls: unknown[] = [];
  Reflect.set(dom, "FB", {
    __buffer: { calls: bufferedCalls },
    init: () => {},
    login: (...args: unknown[]) => bufferedCalls.push(args),
  });
  // Keep happy-dom from fetching a real script; drive both loading stages manually.
  const bootstrapScript = document.createElement("script");
  bootstrapScript.type = "application/json";
  bootstrapScript.src = "https://connect.facebook.net/en_US/sdk.js";
  document.head.appendChild(bootstrapScript);
  let resolved = false;
  const loadingSdk = loadFacebookSdk("123", "v25.0").then((loaded) => {
    resolved = true;
    return loaded;
  });
  bootstrapScript.dispatchEvent(new Event("load"));
  await Promise.resolve();
  expect(resolved).toBe(false);
  Reflect.set(dom, "FB", sdk);
  const readyCallback = Reflect.get(dom, "fbAsyncInit") as () => void;
  readyCallback();
  expect(await loadingSdk).toBe(sdk);
  expect(bufferedCalls).toEqual([]);
  bootstrapScript.remove();
  Reflect.set(dom, "fbAsyncInit", () => {
    throw new Error("Host initializer replayed");
  });
  await expect(loadFacebookSdk("123", "v25.0")).resolves.toBe(sdk);
});

test("Strict Mode and existing SDK deliver a single completion", async () => {
  const results: unknown[] = [];
  const states: WhatsAppOnboardingState[] = [];
  const host = await mount({
    onStateChange: (state) => {
      states.push(state);
    },
    onSuccess: (result) => {
      results.push(result);
    },
  });
  const button = host.querySelector("button");
  expect(button?.disabled).toBe(false);
  await act(async () => {
    button?.click();
  });
  expect(button?.disabled).toBe(false);
  expect(states.at(-1)).toEqual({ isLoading: false, isReady: true, isBusy: true });
  await act(async () => {
    finish();
    loginCallback?.({ authResponse: { code: "code" } });
    finish();
  });
  expect(results).toEqual([
    { waba_id: "789", mode: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", code: "code" },
  ]);
  expect(button?.disabled).toBe(false);
  expect(states.at(-1)).toEqual({ isLoading: false, isReady: true, isBusy: false });
  expect(initCount).toBe(0);
});

test("Embedded Signup defaults to configuration-selected v4 with coexistence", async () => {
  const host = await mount();
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(loginOptions).toEqual({
    config_id: "456",
    response_type: "code",
    override_default_response_type: true,
    extras: { setup: {}, featureType: "whatsapp_business_app_onboarding" },
  });
  await act(async () => {
    loginCallback?.({});
  });
});

for (const version of ["v4", "v4-public-preview"] as const) {
  test(`${version} passes typed business prefill without changing login options`, async () => {
    const setup: EmbeddedSignupSetup = {
      business: {
        name: "Example Company",
        email: "support@example.com",
        website: "https://example.com",
        address: {
          streetAddress1: "Example street",
          streetAddress2: "Suite 1",
          city: "Lisbon",
          state: "Lisbon",
          zipPostal: "1000-001",
          country: "PT",
        },
        phone: { code: 351, number: "210000000" },
        timezone: "UTC+01:00",
      },
    };
    const original = structuredClone(setup);
    const results: unknown[] = [];
    const host = await mount({
      embeddedSignupVersion: version,
      signupMode: "standard",
      setup,
      onSuccess: (result) => {
        results.push(result);
      },
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(loginOptions).toEqual({
      config_id: "456",
      response_type: "code",
      override_default_response_type: true,
      extras: { setup, ...(version === "v4-public-preview" ? { version } : {}) },
    });
    expect(setup).toEqual(original);
    // Meta may return coexistence even when no featureType was requested.
    await act(async () => {
      finish();
      loginCallback?.({ authResponse: { code: "code" } });
    });
    expect(results).toEqual([
      { waba_id: "789", mode: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", code: "code" },
    ]);
  });
  for (const mode of ["standard", "coexistence"] as const) {
    test(`${version} launches ${mode} with the documented extras`, async () => {
      const host = await mount({ embeddedSignupVersion: version, signupMode: mode });
      await act(async () => {
        host.querySelector("button")?.click();
      });
      expect(loginOptions?.extras).toEqual({
        setup: {},
        ...(version === "v4-public-preview" ? { version } : {}),
        ...(mode === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}),
      });
      await act(async () => {
        loginCallback?.({});
      });
    });
  }
}

test("existing business portfolio prefill preserves string identifiers", async () => {
  const setup: EmbeddedSignupSetup = { business: { id: "2729063490586005" } };
  const host = await mount({ setup });
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(loginOptions?.extras).toEqual({ setup, featureType: "whatsapp_business_app_onboarding" });
  await act(async () => {
    loginCallback?.({});
  });
});

for (const version of ["v2", "v3", "v2-public-preview", "v3-public-preview", "v5", "4", "", null]) {
  test(`unsupported Embedded Signup version ${JSON.stringify(version)} never opens login`, async () => {
    const errors: Error[] = [];
    const host = await mount({
      // Simulate an untyped JavaScript consumer or unchecked configuration value.
      embeddedSignupVersion: version as WhatsAppOnboardingProps["embeddedSignupVersion"],
      onError: (error) => {
        errors.push(error);
      },
    });
    await act(async () => {
      host.querySelector("button")?.click();
    });
    expect(loginCallback).toBeUndefined();
    expect(loginOptions).toBeUndefined();
    expect(errors[0]?.message).toContain("Supported Embedded Signup versions");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(errors).toHaveLength(1);
    expect(host.querySelector("button")?.disabled).toBe(false);
  });
}

test("rejected callback reports an error without error UI and restores the button", async () => {
  const errors: Error[] = [];
  const host = await mount({
    onSuccess: async () => {
      throw new Error("Backend unavailable");
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  await act(async () => {
    host.querySelector("button")?.click();
  });
  await act(async () => {
    loginCallback?.({ authResponse: { code: "code" } });
    finish();
  });
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toBe("Connect WhatsApp");
  expect(host.querySelector("button")?.disabled).toBe(false);
  expect(errors.map((error) => error.message)).toEqual(["Backend unavailable"]);
});

test("concurrent components cannot both consume an attempt", async () => {
  const results: unknown[] = [];
  const errors: Error[] = [];
  const host = await mount(
    {
      onSuccess: (result) => {
        results.push(result);
      },
      onError: (error) => {
        errors.push(error);
      },
    },
    2,
  );
  const buttons = host.querySelectorAll("button");
  await act(async () => {
    buttons[0]?.click();
    buttons[1]?.click();
  });
  expect(errors[0]?.message).toContain("already in progress");
  await act(async () => {
    finish();
    loginCallback?.({ authResponse: { code: "code" } });
  });
  expect(results).toEqual([
    { waba_id: "789", mode: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", code: "code" },
  ]);
});

test("unmount keeps an open popup from contaminating the next component", async () => {
  const results: unknown[] = [];
  const errors: Error[] = [];
  const first = await mount({
    onSuccess: (result) => {
      results.push(result);
    },
  });
  await act(async () => {
    first.querySelector("button")?.click();
  });
  const oldCallback = loginCallback;
  await act(async () => {
    roots[0]?.unmount();
  });
  roots = [];
  const second = await mount({
    onError: (error) => {
      errors.push(error);
    },
    onSuccess: (result) => {
      results.push(result);
    },
  });
  await act(async () => {
    second.querySelector("button")?.click();
    finish("CANCEL");
  });
  expect(errors[0]?.message).toContain("already in progress");
  expect(results).toEqual([]);
  await act(async () => {
    oldCallback?.({ authResponse: { code: "old" } });
  });
  await act(async () => {
    second.querySelector("button")?.click();
    finish();
    loginCallback?.({ authResponse: { code: "new" } });
  });
  expect(results).toEqual([
    { waba_id: "789", mode: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", code: "new" },
  ]);
});

test("cancellation and callback rejection release the attempt", async () => {
  const errors: Error[] = [];
  const host = await mount({
    onCancel: async () => {
      throw new Error("Cancel handler failed");
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  await act(async () => {
    host.querySelector("button")?.click();
    finish("CANCEL");
  });
  expect(host.querySelector("button")?.disabled).toBe(false);
  expect(errors[0]?.message).toBe("Cancel handler failed");
  await act(async () => {
    loginCallback?.({});
  });
});

test("an incompatible app reports an error instead of replacing the SDK", async () => {
  const errors: Error[] = [];
  const host = await mount({
    appId: "999",
    onError: (error) => {
      errors.push(error);
    },
  });
  expect(errors[0]?.message).toContain("different app");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("button")?.disabled).toBe(false);
});

test("errors without an onError handler do not render error UI", async () => {
  const host = await mount({ configId: "invalid" });
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(host.textContent).toBe("Connect WhatsApp");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector("button")?.disabled).toBe(false);
  expect(loginCallback).toBeUndefined();
});

test("the child owns button content, styling, ref, and click handler", async () => {
  const ref = createRef<HTMLButtonElement>();
  let clicks = 0;
  const host = await mount({
    children: (
      <button
        ref={ref}
        className="custom"
        style={{ color: "red" }}
        data-action="connect"
        onClick={() => {
          clicks += 1;
        }}
      >
        <span>My button</span>
      </button>
    ),
  });
  const button = host.querySelector("button")!;
  expect(ref.current).toBe(button);
  expect(button.type).toBe("submit");
  expect(button.className).toBe("custom");
  expect(button.style.color).toBe("red");
  expect(button.dataset.action).toBe("connect");
  expect(button.querySelector("span")?.textContent).toBe("My button");
  await act(async () => {
    button.click();
  });
  expect(clicks).toBe(1);
  expect(loginCallback).toBeDefined();
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(button.textContent).toBe("My button");
  await act(async () => {
    loginCallback?.({});
  });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBeNull();
});

test("the child can disable signup or prevent it in its click handler", async () => {
  const disabledHost = await mount({ children: <button disabled>Unavailable</button> });
  await act(async () => {
    disabledHost.querySelector("button")?.click();
  });
  expect(disabledHost.querySelector("button")?.disabled).toBe(true);
  expect(loginCallback).toBeUndefined();
  const host = await mount({
    children: <button onClick={(event) => event.preventDefault()}>Do not connect</button>,
  });
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(loginCallback).toBeUndefined();
  expect(host.querySelector("button")?.disabled).toBe(false);
});

test("custom button props are unchanged while callbacks are pending", async () => {
  function Button(props: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <button {...props} className="design-system" />;
  }
  let resolve: (() => void) | undefined;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const states: WhatsAppOnboardingState[] = [];
  const host = await mount({
    onStateChange: (state) => {
      states.push(state);
    },
    children: <Button>Custom component</Button>,
    onSuccess: () => pending,
  });
  const button = host.querySelector("button")!;
  await act(async () => {
    button.click();
    finish();
    loginCallback?.({ authResponse: { code: "code" } });
  });
  expect(button.className).toBe("design-system");
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBeNull();
  expect(states.at(-1)?.isBusy).toBe(true);
  await act(async () => {
    resolve?.();
  });
  expect(button.disabled).toBe(false);
  expect(states.at(-1)?.isBusy).toBe(false);
});

test("an anchor trigger preserves its props and blocks clicks during signup", async () => {
  let clicks = 0;
  const ref = createRef<HTMLAnchorElement>();
  const host = await mount({
    children: (
      <a
        ref={ref}
        href="#connect"
        onClick={() => {
          clicks += 1;
        }}
      >
        Connect
      </a>
    ),
  });
  const trigger = host.querySelector("a")!;
  expect(ref.current).toBe(trigger);
  expect(trigger.getAttribute("href")).toBe("#connect");
  expect(trigger.hasAttribute("type")).toBe(false);
  expect(trigger.hasAttribute("disabled")).toBe(false);
  await act(async () => {
    trigger.click();
  });
  expect(clicks).toBe(1);
  expect(loginCallback).toBeDefined();
  expect(trigger.getAttribute("aria-disabled")).toBeNull();
  expect(trigger.getAttribute("aria-busy")).toBeNull();
  await act(async () => {
    trigger.click();
  });
  expect(clicks).toBe(2);
  await act(async () => {
    loginCallback?.({});
  });
  expect(trigger.getAttribute("aria-disabled")).toBeNull();
});

test("custom non-button triggers can implement their own keyboard behavior", async () => {
  function Trigger(props: HTMLAttributes<HTMLDivElement> & { disabled?: boolean }) {
    const { disabled: _disabled, ...attributes } = props;
    return (
      <div
        {...attributes}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.click();
        }}
      />
    );
  }
  const host = await mount({ children: <Trigger>Connect</Trigger> });
  const trigger = host.querySelector('[role="button"]')!;
  expect(trigger.hasAttribute("type")).toBe(false);
  await act(async () => {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(loginCallback).toBeDefined();
  expect(trigger.getAttribute("aria-disabled")).toBeNull();
  await act(async () => {
    loginCallback?.({});
  });
});

for (const disabled of [true, "true"] as const) {
  test(`aria-disabled=${disabled} blocks a non-button trigger`, async () => {
    const host = await mount({ children: <span aria-disabled={disabled}>Connect</span> });
    await act(async () => {
      host.querySelector("span")?.click();
    });
    expect(loginCallback).toBeUndefined();
  });
}

test("non-button click handlers can prevent signup", async () => {
  const host = await mount({
    children: (
      <a href="#connect" onClick={(event) => event.preventDefault()}>
        Connect
      </a>
    ),
  });
  await act(async () => {
    host.querySelector("a")?.click();
  });
  expect(loginCallback).toBeUndefined();
});

test("consumers can control disabled and ARIA props using an inline state callback", async () => {
  function Consumer() {
    const [state, setState] = useState<WhatsAppOnboardingState>({
      isLoading: true,
      isReady: false,
      isBusy: false,
    });
    return (
      <WhatsAppOnboarding
        appId="123"
        configId="456"
        onSuccess={() => {}}
        onStateChange={(next) => setState(next)}
      >
        {({ start }) => (
          <button
            type="button"
            onClick={start}
            disabled={!state.isReady || state.isBusy}
            aria-busy={state.isLoading || state.isBusy}
          >
            Connect
          </button>
        )}
      </WhatsAppOnboarding>
    );
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <StrictMode>
        <Consumer />
      </StrictMode>,
    );
  });
  const button = host.querySelector("button")!;
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("false");
  await act(async () => {
    button.click();
  });
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  await act(async () => {
    loginCallback?.({});
  });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-busy")).toBe("false");
});

test("state callback failures reach onError without preventing signup", async () => {
  const errors: Error[] = [];
  const host = await mount({
    onStateChange: () => {
      throw new Error("State handler failed");
    },
    onError: (error) => {
      errors.push(error);
    },
  });
  expect(errors[0]?.message).toBe("State handler failed");
  await act(async () => {
    host.querySelector("button")?.click();
  });
  expect(loginCallback).toBeDefined();
  await act(async () => {
    loginCallback?.({});
  });
});

test("unmount does not emit state notifications from a pending callback", async () => {
  const states: WhatsAppOnboardingState[] = [];
  let resolve: (() => void) | undefined;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const host = await mount({
    onSuccess: () => pending,
    onStateChange: (state) => {
      states.push(state);
    },
  });
  await act(async () => {
    host.querySelector("button")?.click();
    finish();
    loginCallback?.({ authResponse: { code: "code" } });
  });
  expect(states.at(-1)?.isBusy).toBe(true);
  await act(async () => {
    roots[0]?.unmount();
  });
  const count = states.length;
  await act(async () => {
    resolve?.();
  });
  expect(states).toHaveLength(count);
});

test("render props support form submission without implicit click handlers or wrappers", async () => {
  const host = await mount({
    children: ({ start, isReady, isBusy }) => (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <button type="submit" disabled={!isReady || isBusy}>
          Connect
        </button>
      </form>
    ),
  });
  expect(host.firstElementChild?.tagName).toBe("FORM");
  const button = host.querySelector("button")!;
  expect(button.type).toBe("submit");
  expect(loginCallback).toBeUndefined();
  await act(async () => {
    host
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(loginCallback).toBeDefined();
  expect(button.disabled).toBe(true);
  await act(async () => {
    loginCallback?.({});
  });
  expect(button.disabled).toBe(false);
});

test("render props support keyboard activation and multiple rendered elements", async () => {
  const host = await mount({
    children: ({ start }) => (
      <>
        <p>Instructions</p>
        <div
          tabIndex={0}
          role="button"
          onKeyDown={(event) => {
            if (event.key === "Enter") start();
          }}
        >
          Connect
        </div>
      </>
    ),
  });
  expect(host.children).toHaveLength(2);
  await act(async () => {
    host.querySelector("div")?.click();
  });
  expect(loginCallback).toBeUndefined();
  await act(async () => {
    host
      .querySelector("div")
      ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(loginCallback).toBeDefined();
  await act(async () => {
    loginCallback?.({});
  });
});

test("start cannot launch duplicate attempts or launch after unmount", async () => {
  let start: (() => void) | undefined;
  const host = await mount({
    children: (controls) => {
      start = controls.start;
      return null;
    },
  });
  expect(host.children).toHaveLength(0);
  await act(async () => {
    start?.();
  });
  const firstCallback = loginCallback;
  await act(async () => {
    start?.();
  });
  expect(loginCallback).toBe(firstCallback);
  await act(async () => {
    loginCallback?.({});
  });
  await act(async () => {
    roots[0]?.unmount();
  });
  loginCallback = undefined;
  await act(async () => {
    start?.();
  });
  expect(loginCallback).toBeUndefined();
});
