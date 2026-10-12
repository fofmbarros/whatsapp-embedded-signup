/** Verbose development diagnostics without exposing exchangeable credentials. */
export function redactCredentials(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactCredentials);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      /^(code|.*token|app_?secret|authorization)$/i.test(key)
        ? "[REDACTED]"
        : redactCredentials(entry),
    ]),
  );
}

export function debugLog(label: string, value: unknown) {
  if (import.meta.env.DEV) console.info(`[WhatsApp example] ${label}`, redactCredentials(value));
}
