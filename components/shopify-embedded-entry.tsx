"use client";

import { useEffect, useState } from "react";
import { FraudCommandCenter } from "@/components/fraud-command-center";

export function ShopifyEmbeddedEntry() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    const originalFetch = window.fetch;
    const authenticatedFetch: typeof fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return originalFetch(input, init);
      const bridge = (window as unknown as { shopify?: { idToken(): Promise<string> } }).shopify;
      if (!bridge) throw new Error("SHOPIFY_BRIDGE_UNAVAILABLE");
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set("Authorization", `Bearer ${await bridge.idToken()}`);
      return originalFetch(input, { ...init, headers, credentials: "omit" });
    };
    window.fetch = authenticatedFetch;
    const authenticate = async () => {
    try {
      if (window.self === window.top) throw new Error("NOT_EMBEDDED");
      // Explicitly request a current token for each API call, including background
      // refreshes. Never send it to third-party origins or store it in a cookie.
      const response = await fetch("/api/auth/shopify", { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("SHOPIFY_AUTH_FAILED");
      setState("ready");
    } catch { setState("error"); }
  }; void authenticate();
    return () => { if (window.fetch === authenticatedFetch) window.fetch = originalFetch; };
  }, []);
  return <>
    {state === "ready" ? <FraudCommandCenter /> : <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <section role="status" style={{ textAlign: "center" }}>
        <h1>ShopShield</h1>
        <p>{state === "loading" ? "מאמת הרשאת כניסה דרך Shopify…" : "לא הצלחנו לאמת את הגישה דרך Shopify. יש לפתוח את האפליקציה מחדש מתוך החנות."}</p>
        {state === "error" && <button onClick={() => window.location.reload()}>ניסיון נוסף</button>}
      </section>
    </main>}
  </>;
}
