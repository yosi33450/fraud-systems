// Keep App Bridge's global fetch untouched; wrapping it globally can intercept
// the bridge's own token-refresh requests.
export const browserApiFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined") return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const bridge = (window as unknown as { shopify?: { idToken(): Promise<string> } }).shopify;
  if (window.self === window.top || !bridge || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return window.fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set("Authorization", `Bearer ${await bridge.idToken()}`);
  return window.fetch(input, { ...init, headers, credentials: "omit" });
};
