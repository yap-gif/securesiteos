import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  BillingGuardError, isTestKey, reconcileTestSubscription,
  type StoredSubscription, type SubscriptionWrite,
} from "@/lib/billingCore";

export const runtime = "nodejs";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
]);

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  const key = process.env.STRIPE_SECRET_KEY;
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!isTestKey(key) || !secret?.startsWith("whsec_")) {
    return NextResponse.json({ error: "Stripe TEST webhook not configured" }, { status: 503 });
  }
  const stripe = new Stripe(key!);
  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret);
  } catch {
    // Never reflect raw signature/body/secret back to callers.
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 400 });
  }
  if (event.livemode !== false) {
    return NextResponse.json({ error: "Live events rejected" }, { status: 400 });
  }
  if (!SUBSCRIPTION_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, ignored: true });
  }
  const subId = (event.data.object as { id?: unknown }).id;
  if (typeof subId !== "string" || !subId.startsWith("sub_")) {
    return NextResponse.json({ error: "Invalid subscription event" }, { status: 422 });
  }
  // Prevent accidental writes into the normal Supabase project during Stripe test mode.
  // This env flag is a manual assertion, NOT a technical proof of isolation.
  if (process.env.BILLING_TEST_DATABASE_ISOLATED !== "YES") {
    return NextResponse.json({ error: "Isolated billing test database not acknowledged" }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Server not configured" }, { status: 503 });
  const allowedPriceIds = [
    process.env.STRIPE_PRICE_BASIC,
    process.env.STRIPE_PRICE_PRO,
    process.env.STRIPE_PRICE_ENTERPRISE,
  ].filter((id): id is string => Boolean(id));
  if (allowedPriceIds.length !== 3 || new Set(allowedPriceIds).size !== 3) {
    return NextResponse.json({ error: "Stripe test price configuration incomplete" }, { status: 503 });
  }
  try {
    await reconcileTestSubscription({
      subscriptionId: subId,
      allowedPriceIds,
      ports: {
        retrieveSubscription: (id) => stripe.subscriptions.retrieve(id),
        loadExisting: async (userId): Promise<StoredSubscription | null> => {
          const { data: row, error: dbError } = await admin
            .from("subscriptions")
            .select("user_id,stripe_customer_id,stripe_subscription_id,status")
            .eq("user_id", userId)
            .maybeSingle();
          if (dbError) throw new Error("SUBSCRIPTION_READ_FAILED");
          return row;
        },
        upsertSubscription: async (row: SubscriptionWrite) => {
          const { error: dbError } = await admin
            .from("subscriptions")
            .upsert(row, { onConflict: "user_id" });
          if (dbError) throw new Error("SUBSCRIPTION_WRITE_FAILED");
        },
      },
    });
    // Returning 2xx only after the critical DB upsert succeeds.
    return NextResponse.json({ received: true });
  } catch (caught: unknown) {
    if (caught instanceof BillingGuardError) {
      // 409/422 deliberately remain non-2xx for investigation and Stripe retry.
      return NextResponse.json({ error: caught.code }, { status: caught.statusCode });
    }
    console.error("STRIPE_TEST_WEBHOOK_PROCESSING_FAILED");
    return NextResponse.json({ error: "Webhook processing failed; retry" }, { status: 503 });
  }
}
