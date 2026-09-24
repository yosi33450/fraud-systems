import type { Employee, FraudCase, RiskRule, Store } from "@/lib/types";

// The product starts with a clean workspace. Data is created only from a real
// Shopify connection or an explicit action by the platform owner.
export const stores: Store[] = [];
export const cases: FraudCase[] = [];
export const rules: RiskRule[] = [];
export const employees: Employee[] = [];
