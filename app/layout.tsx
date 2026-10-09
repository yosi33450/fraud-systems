import type { Metadata } from "next";
import { headers } from "next/headers";
import { EMBEDDED_CLIENT_ID } from "@/lib/shopify-embedded-auth";
import "@fontsource-variable/heebo";
import "./globals.css";
import "./product-ui.css";

export const metadata: Metadata = {
  title: "Shield Ledger — מרכז מניעת הונאות",
  description: "מרכז חקירות והתראות לחנויות Shopify",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const embedded = (await headers()).get("x-shopshield-embedded") === "1";
  return (
    <html lang="he" dir="rtl">
      <head>{embedded && <>
        <meta name="shopify-api-key" content={EMBEDDED_CLIENT_ID} />
        {/* App Bridge requires a synchronous CDN script before framework scripts. */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </>}</head>
      <body>{children}</body>
    </html>
  );
}
