"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Plan = { key: "basic" | "pro" | "enterprise"; name: string; price: string };

const plans: Plan[] = [
  { key: "basic", name: "Basic", price: "RM39/mo" },
  { key: "pro", name: "Pro", price: "RM99/mo" },
  { key: "enterprise", name: "Enterprise", price: "RM299/mo" },
];

export default function PricingPage() {
  return (
    <Suspense fallback={<main className="min-h-screen p-8">Loading pricing...</main>}>
      <PricingContent />
    </Suspense>
  );
}

function PricingContent() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const checkoutStatus = searchParams.get("checkout");
  const checkoutNotice =
    checkoutStatus === "processing"
      ? "Test checkout returned. Subscription confirmation is pending webhook processing; refresh the dashboard after confirmation."
      : checkoutStatus === "cancelled"
        ? "Test checkout was cancelled; your subscription was not changed."
        : "";

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
    });
  }, []);

  async function checkout(plan: Plan["key"]) {
    setMsg("");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      window.location.assign("/login");
      return;
    }

    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ plan }),
    });

    const json = await res.json();
    if (!res.ok) return setMsg(json.error || "Checkout failed");
    window.location.assign(json.url);
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold">Pricing</h1>

        {!userId && (
          <div className="rounded border p-4">
            You are not logged in. <a className="underline" href="/login">Log in</a>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((p) => (
            <div key={p.key} className="rounded-xl border p-5 space-y-3">
              <div className="text-xl font-semibold">{p.name}</div>
              <div className="text-gray-600">{p.price}</div>
              <button
                className="w-full rounded bg-black p-3 text-white"
                onClick={() => checkout(p.key)}
              >
                Subscribe
              </button>
            </div>
          ))}
        </div>

        {(msg || checkoutNotice) && <div className="rounded border p-3 text-sm">{msg || checkoutNotice}</div>}
      </div>
    </main>
  );
}