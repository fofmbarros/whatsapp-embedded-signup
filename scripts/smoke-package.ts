import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarball = resolve(process.argv[2] ?? "package.tgz");
const directory = mkdtempSync(join(tmpdir(), "whatsapp-embedded-signup-smoke-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync(
    npm,
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
      "react@19",
      "react-dom@19",
      "@types/react@19",
      "typescript@5.9",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  const packageDirectory = join(directory, "node_modules/@fofmbarros/whatsapp-embedded-signup");
  const entrypoint = readFileSync(join(packageDirectory, "dist/index.js"), "utf8");
  if (!entrypoint.startsWith('"use client";')) throw new Error("Missing client directive");
  for (const file of ["README.md", "LICENSE", "CHANGELOG.md", "dist/index.d.ts"]) {
    readFileSync(join(packageDirectory, file));
  }
  writeFileSync(
    join(directory, "smoke.mjs"),
    `import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { WhatsAppOnboarding } from "@fofmbarros/whatsapp-embedded-signup";
const html = renderToString(createElement(WhatsAppOnboarding, {
  appId: "123", configId: "456", onSuccess() {},
  children: () => createElement("button", null, "Connect")
}));
if (!html.includes("Connect")) throw new Error("SSR smoke test failed");
`,
  );
  execFileSync("node", ["smoke.mjs"], { cwd: directory, stdio: "inherit" });
  writeFileSync(
    join(directory, "smoke.ts"),
    `import { WhatsAppOnboarding, type WhatsAppOnboardingProps, type SignupResult } from "@fofmbarros/whatsapp-embedded-signup";
const props: WhatsAppOnboardingProps = {
  appId: "123", configId: "456", onSuccess(result: SignupResult) { void result.code; }, children: () => null
};
void WhatsAppOnboarding;
void props;
`,
  );
  execFileSync(
    "node",
    [
      "node_modules/typescript/bin/tsc",
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "smoke.ts",
    ],
    { cwd: directory, stdio: "inherit" },
  );
  console.log("Packed package passes Node import, SSR, and TypeScript smoke tests.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
