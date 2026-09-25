"use client";

import { FormEvent, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setLoading(false);
    if (!response.ok) {
      setError(response.status === 401 ? "הסיסמה אינה נכונה" : "לא ניתן להתחבר כרגע");
      return;
    }
    const next = searchParams.get("next");
    window.location.assign(next?.startsWith("/") ? next : "/");
  };

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-brand"><ShieldCheck size={25} /><span>Shield Ledger</span></div>
        <div className="login-icon"><LockKeyhole size={27} /></div>
        <h1 id="login-title">כניסה מאובטחת</h1>
        <p>מרכז ההתראות והחקירות של החנות שלך.</p>
        <form onSubmit={submit}>
          <label htmlFor="password">סיסמת מנהל</label>
          <input
            id="password"
            name="password"
            type="password"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "login-error" : undefined}
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            autoFocus
          />
          {error && <div id="login-error" className="login-error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "מתחבר…" : "כניסה למערכת"}
          </button>
        </form>
        <small>הגישה מוגבלת לבעלים ולצוות שאושר.</small>
      </section>
    </main>
  );
}
