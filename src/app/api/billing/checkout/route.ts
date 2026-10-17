import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  BillingGuardError, isTestKey, parsePlan, prepareTestCheckout,
  type StoredSubscription, type StripeCustomerView,
} from "@/lib/billingCore";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Missing auth" }, { status: 401 });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!isTestKey(stripeKey)) {
    return NextResponse.json({ error: "Stripe TEST mode is not configured" }, { status: 503 });
  }
  // Explicit opt-in: this does not prove isolation; verify the Supabase project manually.
  if (process.env.BILLING_TEST_DATABASE_ISOLATED !== "YES") {
    return NextResponse.json({ error: "Isolated billing test database not acknowledged" }, { status: 503 });
  }
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "Server not configured" }, { status: 503 });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const input: unknown = await req.json().catch(() => null);
  const planInput = input && typeof input === "object" && "plan" in input ? input.plan : null;
  const plan = parsePlan(planInput);
  if (!plan) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const priceIds = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE,
  };
  const priceId = priceIds[plan];
  if (!priceId) return NextResponse.json({ error: "Test price not configured" }, { status: 503 });

  const stripe = new Stripe(stripeKey!);
  try {
    const url = await prepareTestCheckout({
      userId: data.user.id,
      email: data.user.email,
      plan,
      priceId,
      appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
      ports: {
        loadExisting: async (userId): Promise<StoredSubscription | null> => {
          const { data: row, error: dbError } = await admin
            .from("subscriptions")
            .select("user_id,stripe_customer_id,stripe_subscription_id,status")
            .eq("user_id", userId)
            .maybeSingle();
          if (dbError) throw new Error("SUBSCRIPTION_READ_FAILED");
          return row;
        },
        retrievePrice: async (id) => {
          const price = await stripe.prices.retrieve(id);
          return {
            id: price.id, active: price.active, livemode: price.livemode,
            type: price.type, currency: price.currency, unit_amount: price.unit_amount,
            recurring: price.recurring ? {
              interval: price.recurring.interval,
              interval_count: price.recurring.interval_count,
            } : null,
          };
        },
        retrieveCustomer: async (id): Promise<StripeCustomerView | null> => {
          const customer = await stripe.customers.retrieve(id);
          if ("deleted" in customer && customer.deleted) return null;
          if ("deleted" in customer) return null;
          return { id: customer.id, livemode: customer.livemode, metadata: customer.metadata };
        },
        searchCustomers: async (userId): Promise<StripeCustomerView[]> => {
          // Stripe search is eventually consistent; customer creation additionally uses
          // an idempotency key. Neither guarantees global uniqueness without a DB constraint.
          const result = await stripe.customers.search({
            query: `metadata['user_id']:'${userId}'`, limit: 3,
          });
          return result.data.map((customer) => ({
            id: customer.id, livemode: customer.livemode, metadata: customer.metadata,
          }));
        },
        createCustomer: async (userId, email): Promise<StripeCustomerView> => {
          const customer = await stripe.customers.create(
            { email, metadata: { user_id: userId } },
            { idempotencyKey: `ssos-test-customer-v1-${userId}` },
          );
          return { id: customer.id, livemode: customer.livemode, metadata: customer.metadata };
        },
        createSession: async (customerId, id, userId, plan, baseUrl) => {
          const session = await stripe.checkout.sessions.create({
            mode: "subscription",
            customer: customerId,
            line_items: [{ price: id, quantity: 1 }],
            success_url: `${baseUrl}/pricing?checkout=processing`,
            cancel_url: `${baseUrl}/pricing?checkout=cancelled`,
            client_reference_id: userId,
            metadata: { user_id: userId, plan },
            subscription_data: { metadata: { user_id: userId } },
          });
          return { url: session.url };
        },
      },
    });
    // Never upsert 'pending' here. Verified Stripe webhooks own subscription status.
    return NextResponse.json({ url });
  } catch (caught: unknown) {
    if (caught instanceof BillingGuardError) {
      return NextResponse.json({ error: caught.code }, { status: caught.statusCode });
    }
    console.error("STRIPE_TEST_CHECKOUT_FAILED");
    return NextResponse.json({ error: "Checkout temporarily unavailable" }, { status: 503 });
  }
}
