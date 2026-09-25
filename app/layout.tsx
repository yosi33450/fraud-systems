import type { Metadata } from "next";
import "@fontsource-variable/heebo";
import "@fontsource-variable/noto-sans-hebrew";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shield Ledger — מרכז מניעת הונאות",
  description: "מרכז חקירות והתראות לחנויות Shopify",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
