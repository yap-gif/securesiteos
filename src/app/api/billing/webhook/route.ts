import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";



// webhook 里不要过度相信 typings，用安全读取
function getUnix(obj: object | null | undefined, key: string): number | null {
  const value: unknown = obj ? Reflect.get(obj, key) : null;
  return typeof value === "number" ? value : null;
}

function toIsoFromUnix(ts: number | null) {
  return ts ? new Date(ts * 1000).toISOString() : null;
}

export async function POST(req: Request) {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing stripe-signature" }, { status: 400 });

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured" }, { status: 503 });
  }
  const stripe = new Stripe(stripeKey);
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Invalid webhook signature";
    return NextResponse.json({ error: `Webhook signature failed: ${message}` }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  const upsertFromSubscription = async (sub: Stripe.Subscription) => {
    const userId = (sub?.metadata?.user_id ?? null) as string | null;
    if (!userId) return;

    const priceId = (sub?.items?.data?.[0]?.price?.id ?? null) as string | null;

    // ✅ 兼容不同 stripe typings / payload 版本
    const currentPeriodEndUnix =
      getUnix(sub, "current_period_end") ??
      getUnix(sub, "current_period_end_at") ??
      getUnix(sub, "current_period_end_ts");

    await supabaseAdmin.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: String(sub.customer),
      stripe_subscription_id: String(sub.id),
      price_id: priceId,
      status: String(sub.status ?? "inactive"),
      current_period_end: toIsoFromUnix(currentPeriodEndUnix),
    });
  };

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated"
  ) {
    await upsertFromSubscription(event.data.object as Stripe.Subscription);
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const userId = (sub?.metadata?.user_id ?? null) as string | null;

    if (userId) {
      const priceId = (sub?.items?.data?.[0]?.price?.id ?? null) as string | null;

      await supabaseAdmin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: String(sub.customer),
        stripe_subscription_id: String(sub.id),
        price_id: priceId,
        status: "canceled",
        current_period_end: null,
      });
    }
  }

  return NextResponse.json({ received: true });
}