// Keep App Bridge's global fetch untouched; wrapping it globally can intercept
// the bridge's own token-refresh requests.
export const browserApiFetch: typeof fetch = async (input, init) => {
  if (typeof window === "undefined") return fetch(input, init);
  const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
  const bridge = (window as unknown as { shopify?: { idToken(): Promise<string> } }).shopify;
  if (window.self === window.top || !bridge || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return window.fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = await bridge.idToken();
  headers.set("Authorization", `Bearer ${token}`);
  const response = await window.fetch(input, { ...init, headers, credentials: "omit" });
  if (response.status === 401) {
    try {
      const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      console.warn("Embedded request rejected", { path: url.pathname, expiresIn: claims.exp - Date.now() / 1000, lifetime: claims.exp - claims.iat, retryHeader: response.headers.get("X-Shopify-Retry-Invalid-Session-Request") });
    } catch { console.warn("Embedded request rejected: invalid token format"); }
  }
  return response;
};
