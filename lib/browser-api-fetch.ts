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
  const request = new Request(input instanceof Request ? input : url, { ...init, headers, credentials: "omit" });
  const response = await window.fetch(request.clone());
  // Retry only when our authentication gate rejected the request BEFORE its
  // handler ran. This cannot duplicate a mutation. Shopify can cache a token
  // right up to its expiry; give that cache one second to roll over.
  if (response.status === 401 && response.headers.get("X-Shopify-Retry-Invalid-Session-Request") === "1") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    request.signal.throwIfAborted();
    request.headers.set("Authorization", `Bearer ${await bridge.idToken()}`);
    return window.fetch(request);
  }
  return response;
};
