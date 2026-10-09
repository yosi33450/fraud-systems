import type { Metadata } from "next";
import { ShopifyEmbeddedEntry } from "@/components/shopify-embedded-entry";
import { EMBEDDED_CLIENT_ID } from "@/lib/shopify-embedded-auth";

export const metadata: Metadata = { title: "ShopShield", other: { "shopify-api-key": EMBEDDED_CLIENT_ID } };
// Public bootstrap only. All data requests require a verified Shopify ID token.
export default function ShopifyPage() { return <ShopifyEmbeddedEntry />; }
