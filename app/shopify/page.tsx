import type { Metadata } from "next";
import { ShopifyEmbeddedEntry } from "@/components/shopify-embedded-entry";

export const metadata: Metadata = { title: "ShopShield" };
// Public bootstrap only. All data requests require a verified Shopify ID token.
export default function ShopifyPage() { return <ShopifyEmbeddedEntry />; }
