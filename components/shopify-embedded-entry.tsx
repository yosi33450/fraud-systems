"use client";

import { useEffect, useState } from "react";
import { FraudCommandCenter } from "@/components/fraud-command-center";

export function ShopifyEmbeddedEntry() {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => { const authenticate = async () => {
    try {
      if (window.self === window.top) throw new Error("NOT_EMBEDDED");
      // App Bridge attaches and refreshes a signed ID token for every same-origin
      // fetch. No long-lived session cookie or query-string token is created.
      const response = await fetch("/api/auth/shopify", { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("SHOPIFY_AUTH_FAILED");
      setState("ready");
    } catch { setState("error"); }
  }; void authenticate(); }, []);
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
