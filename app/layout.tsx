import type { Metadata } from "next";
import "@fontsource-variable/heebo";
import "./globals.css";
import "./product-ui.css";

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
