import Stripe from "stripe";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: "2024-06-20" as any });

function priceIdFor(plan: string) {
  if (plan === "basic") return process.env.STRIPE_PRICE_BASIC!;
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO!;
  if (plan === "enterprise") return process.env.STRIPE_PRICE_ENTERPRISE!;
  return null;
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Missing auth" }, { status: 401 });

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return NextResponse.json({ error: "Server not configured" }, { status: 500 });

  // 用 service role 验证 token 拿 user
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { plan } = await req.json();
  const priceId = priceIdFor(plan);
  if (!priceId) return NextResponse.json({ error: "Invalid plan/price id missing" }, { status: 400 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  // customer：用 email 创建/复用（MVP）
  const customer = await stripe.customers.create({
    email: data.user.email || undefined,
    metadata: { user_id: data.user.id },
  });

  // checkout session
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/dashboard/logs`,
    cancel_url: `${appUrl}/pricing`,
    subscription_data: {
      metadata: { user_id: data.user.id },
    },
  });

  // 预写 customer_id（可选）
  await supabaseAdmin.from("subscriptions").upsert({
    user_id: data.user.id,
    stripe_customer_id: customer.id,
    status: "pending",
    price_id: priceId,
  });

  return NextResponse.json({ url: session.url });
}