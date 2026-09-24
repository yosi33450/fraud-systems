"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="error-page"><AlertTriangle size={30} /><h1>לא הצלחנו לטעון את מרכז הבקרה</h1><p>המידע שלך נשאר שמור. אפשר לנסות לטעון שוב.</p><button className="primary-button" onClick={reset}><RefreshCcw size={16} /> ניסיון נוסף</button></main>;
}
