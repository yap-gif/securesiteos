// Run on Node.js 24 with project dependencies installed: node --test tests/phase3c-billing.test.mjs
// Mock-based; deliberately does NOT call Stripe's network API or Supabase.
import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import {
  isTestKey, parsePlan, assertTestPrice, prepareTestCheckout,
  reconcileTestSubscription, BillingGuardError,
} from "../src/lib/billingCore.ts";

const uuid = "123e4567-e89b-42d3-a456-426614174000";
const futurePeriod = 1824000000;
const validPrice = {
  id: "price_TEST123", active: true, livemode: false, currency: "myr",
  type: "recurring", unit_amount: 3900,
  recurring: { interval: "month", interval_count: 1 },
};
function checkoutPorts(override = {}) {
  return {
    loadExisting: async () => null,
    retrievePrice: async () => validPrice,
    retrieveCustomer: async () => ({ id: "cus_TEST", livemode: false, metadata: { user_id: uuid } }),
    searchCustomers: async () => [],
    createCustomer: async () => ({ id: "cus_TEST", livemode: false, metadata: { user_id: uuid } }),
    createSession: async () => ({ url: "https://checkout.stripe.com/c/pay/test_example" }),
    ...override,
  };
}
function checkout(ports) {
  return prepareTestCheckout({ ports, userId: uuid, email: "test@example.invalid", plan: "basic",
    priceId: "price_TEST123", appUrl: "http://localhost:3000" });
}
function snapshot(status = "active", currentPeriodEnd = futurePeriod) {
  return {
    id: "sub_TEST123", livemode: false, customer: "cus_TEST", metadata: { user_id: uuid }, status,
    items: { data: [{ price: { id: "price_TEST123" }, current_period_end: currentPeriodEnd }] },
  };
}
function webhookPorts(override = {}) {
  let row = null;
  const written = [];
  return {
    written,
    retrieveSubscription: async () => snapshot(),
    loadExisting: async () => row,
    upsertSubscription: async (next) => { row = next; written.push(next); },
    ...override,
  };
}
function webhook(ports) {
  return reconcileTestSubscription({ ports, subscriptionId: "sub_TEST123", allowedPriceIds: ["price_TEST123"] });
}

test("only test-mode secret keys are accepted", () => {
  assert.equal(isTestKey("sk_test_a_test_value"), true);
  assert.equal(isTestKey("sk_live_actualorplaceholder"), false);
  assert.equal(isTestKey(undefined), false);
});
test("plan inputs are allowlisted", () => {
  assert.equal(parsePlan("basic"), "basic");
  assert.equal(parsePlan("no-such-plan"), null);
  assert.equal(parsePlan({ plan: "basic" }), null);
});
test("price must be test, MYR, matching monthly amount and active", () => {
  assert.doesNotThrow(() => assertTestPrice(validPrice, validPrice.id, "basic"));
  assert.throws(() => assertTestPrice({ ...validPrice, livemode: true }, validPrice.id, "basic"), BillingGuardError);
  assert.throws(() => assertTestPrice({ ...validPrice, unit_amount: 500 }, validPrice.id, "basic"), BillingGuardError);
});
test("checkout creates one customer and preserves pending-free status model", async () => {
  let creates = 0;
  let sessions = 0;
  const ports = checkoutPorts({
    createCustomer: async () => { creates++; return { id: "cus_TEST", livemode: false, metadata: { user_id: uuid } }; },
    createSession: async () => { sessions++; return { url: "https://checkout.stripe.com/c/pay/test_example" }; },
  });
  assert.match(await checkout(ports), /^https:\/\/checkout.stripe.com/);
  assert.equal(creates, 1);
  assert.equal(sessions, 1);
});
test("checkout reuses mapped Customer instead of creating a duplicate", async () => {
  let creates = 0;
  const ports = checkoutPorts({
    loadExisting: async () => ({ user_id: uuid, stripe_customer_id: "cus_TEST", stripe_subscription_id: null, status: "canceled" }),
    createCustomer: async () => { creates++; throw new Error("should not create customer"); },
  });
  await checkout(ports);
  assert.equal(creates, 0);
});
test("checkout rejects existing active subscribers and ambiguous customers", async () => {
  await assert.rejects(checkout(checkoutPorts({ loadExisting: async () => ({ status: "active" }) })),
    (e) => e instanceof BillingGuardError && e.statusCode === 409);
  await assert.rejects(checkout(checkoutPorts({ searchCustomers: async () => [
    { id: "cus_A", livemode: false, metadata: { user_id: uuid } },
    { id: "cus_B", livemode: false, metadata: { user_id: uuid } },
  ] })), (e) => e instanceof BillingGuardError && e.statusCode === 409);
});
test("Stripe HMAC signature must match the unmodified raw body", () => {
  const stripe = new Stripe("sk_test_test_signature_only");
  const secret = "whsec_local_nonsecret_test_fixture";
  const payload = JSON.stringify({ id: "evt_fake", object: "event", livemode: false,
    type: "customer.subscription.updated", data: { object: { id: "sub_TEST123" } } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  assert.equal(stripe.webhooks.constructEvent(payload, signature, secret).id, "evt_fake");
  assert.throws(() => stripe.webhooks.constructEvent(payload + " ", signature, secret));
});
test("subscription created/updated writes canonical Stripe status and item period", async () => {
  const ports = webhookPorts();
  const row = await webhook(ports);
  assert.equal(row.status, "active");
  assert.equal(row.current_period_end, new Date(futurePeriod * 1000).toISOString());
  assert.equal(ports.written.length, 1);
});
test("cancellation updates the same subscription to canceled", async () => {
  const ports = webhookPorts({ retrieveSubscription: async () => snapshot("canceled", null) });
  const row = await webhook(ports);
  assert.equal(row.status, "canceled");
  assert.equal(row.current_period_end, null);
});
test("duplicate deliveries are value-idempotent but still perform writes", async () => {
  const ports = webhookPorts();
  const a = await webhook(ports);
  const b = await webhook(ports);
  assert.deepEqual(a, b);
  assert.equal(ports.written.length, 2); // No durable event ID deduplication yet.
});
test("a stale event snapshot cannot override a fresh canonical Stripe status", async () => {
  // The reconciler deliberately receives an ID only and retrieves the latest Stripe state.
  const ports = webhookPorts({ retrieveSubscription: async () => snapshot("canceled", null) });
  assert.equal((await webhook(ports)).status, "canceled");
});
test("active subscription from another ID cannot be overwritten", async () => {
  const ports = webhookPorts({ loadExisting: async () => ({
    user_id: uuid, stripe_customer_id: "cus_TEST", stripe_subscription_id: "sub_OTHER", status: "active",
  }) });
  await assert.rejects(webhook(ports), (e) => e instanceof BillingGuardError && e.statusCode === 409);
});
test("live Stripe subscription is rejected", async () => {
  const ports = webhookPorts({ retrieveSubscription: async () => ({ ...snapshot(), livemode: true }) });
  await assert.rejects(webhook(ports), (e) => e instanceof BillingGuardError && e.statusCode === 400);
});
test("failed database writes are propagated instead of acknowledged", async () => {
  const ports = webhookPorts({ upsertSubscription: async () => { throw new Error("SUPABASE_WRITE_FAILED"); } });
  await assert.rejects(webhook(ports), /SUPABASE_WRITE_FAILED/);
});
test("missing metadata or unknown price is rejected", async () => {
  await assert.rejects(webhook(webhookPorts({ retrieveSubscription: async () => ({ ...snapshot(), metadata: {} }) })),
    (e) => e instanceof BillingGuardError && e.statusCode === 422);
  await assert.rejects(webhook(webhookPorts({ retrieveSubscription: async () => ({
    ...snapshot(), items: { data: [{ price: { id: "price_UNEXPECTED" }, current_period_end: futurePeriod }] },
  }) })), (e) => e instanceof BillingGuardError && e.statusCode === 422);
});
