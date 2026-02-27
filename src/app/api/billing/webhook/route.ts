import Stripe from "stripe";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" as any });

export async function POST(req: Request) {
  const sig = (await headers()).get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook Error: ${err.message}` }, { status: 400 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  // 处理订阅事件
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    const sub = event.data.object as Stripe.Subscription;
    const userId = (sub.metadata?.user_id || null) as string | null;

    if (userId) {
      const priceId = (sub.items.data[0]?.price?.id || null) as string | null;
      const currentPeriodEnd = sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;

      await supabaseAdmin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: String(sub.customer),
        stripe_subscription_id: sub.id,
        price_id: priceId,
        status: sub.status,
        current_period_end: currentPeriodEnd,
      });
    }
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as Stripe.Subscription;
    const userId = (sub.metadata?.user_id || null) as string | null;
    if (userId) {
      await supabaseAdmin.from("subscriptions").upsert({
        user_id: userId,
        stripe_customer_id: String(sub.customer),
        stripe_subscription_id: sub.id,
        price_id: sub.items.data[0]?.price?.id ?? null,
        status: "canceled",
        current_period_end: null,
      });
    }
  }

  return NextResponse.json({ received: true });
}