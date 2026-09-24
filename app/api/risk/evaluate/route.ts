import { NextResponse } from "next/server";
import { evaluateRisk, type OrderSignals } from "@/lib/risk-engine";

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

function validateSignals(value: unknown): value is OrderSignals {
  if (!value || typeof value !== "object") return false;
  const body = value as Partial<OrderSignals>;
  return [
    body.ordersByEmailLastHour,
    body.ordersByIpLastTwoHours,
    body.giftCardOrdersByIpLastTwoHours,
    body.emailsByIpLastTwoHours,
    body.identitiesByPhoneLastDay,
    body.orderAmount,
    body.averageOrderValue,
    body.giftCardValue,
    body.giftCardBaseline,
    body.paymentFailures,
  ].every(isNumber)
    && isBoolean(body.billingShippingMismatch)
    && isBoolean(body.employeeMatch)
    && isBoolean(body.refundAfterFulfillment)
    && ["none", "low", "medium", "high"].includes(body.shopifyRisk ?? "")
    && Boolean(body.blacklist)
    && isBoolean(body.blacklist?.email)
    && isBoolean(body.blacklist?.phone)
    && isBoolean(body.blacklist?.address)
    && isBoolean(body.blacklist?.ip)
    && isBoolean(body.blacklist?.customer);
}

export async function POST(request: Request) {
  const payload: unknown = await request.json().catch(() => null);
  if (!validateSignals(payload)) {
    return NextResponse.json({ error: "INVALID_RISK_SIGNALS" }, { status: 400 });
  }
  return NextResponse.json(evaluateRisk(payload));
}
