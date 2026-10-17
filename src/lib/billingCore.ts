// Phase 3C TEST-MODE ONLY business logic. No database or network operations at import time.
export type PlanKey = "basic" | "pro" | "enterprise";
export type StoredSubscription = {
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string;
};
export type StripeCustomerView = {
  id: string;
  livemode: boolean;
  metadata: Record<string, string>;
};
export type StripePriceView = {
  id: string;
  active: boolean;
  livemode: boolean;
  currency: string;
  type: string;
  unit_amount: number | null;
  recurring: { interval: string; interval_count: number } | null;
};
export type StripeSubscriptionView = {
  id: string;
  livemode: boolean;
  customer: string | { id: string };
  metadata: Record<string, string>;
  status: string;
  items: { data: Array<{ price: { id: string }; current_period_end?: number | null }> };
};
export type SubscriptionWrite = {
  user_id: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  price_id: string;
  status: string;
  current_period_end: string | null;
};
export class BillingGuardError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(statusCode: number, code: string) {
    super(code);
    this.name = "BillingGuardError";
    this.statusCode = statusCode;
    this.code = code;
  }
}
export const PLAN_AMOUNTS: Record<PlanKey, number> = {
  basic: 3900,
  pro: 9900,
  enterprise: 29900,
};
export function parsePlan(input: unknown): PlanKey | null {
  return input === "basic" || input === "pro" || input === "enterprise" ? input : null;
}
export function isTestKey(input: string | undefined): boolean {
  return Boolean(input && input.startsWith("sk_test_") && input.length > 10);
}
export function assertTestPrice(price: StripePriceView, id: string, plan: PlanKey): void {
  if (
    price.id !== id || !/^price_[A-Za-z0-9]+$/.test(id) || price.livemode ||
    !price.active || price.type !== "recurring" || price.currency.toLowerCase() !== "myr" ||
    price.unit_amount !== PLAN_AMOUNTS[plan] ||
    price.recurring?.interval !== "month" || price.recurring.interval_count !== 1
  ) {
    throw new BillingGuardError(503, "STRIPE_TEST_PRICE_MISMATCH");
  }
}
export function assertLocalAppUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BillingGuardError(503, "INVALID_APP_URL"); }
  if ((url.hostname !== "localhost" && url.hostname !== "127.0.0.1") ||
      url.protocol !== "http:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    throw new BillingGuardError(503, "NOT_A_LOCAL_TEST_URL");
  }
  return url.origin;
}
export interface CheckoutPorts {
  loadExisting(userId: string): Promise<StoredSubscription | null>;
  retrievePrice(priceId: string): Promise<StripePriceView>;
  retrieveCustomer(customerId: string): Promise<StripeCustomerView | null>;
  searchCustomers(userId: string): Promise<StripeCustomerView[]>;
  createCustomer(userId: string, email: string | undefined): Promise<StripeCustomerView>;
  createSession(customerId: string, priceId: string, userId: string, plan: PlanKey, baseUrl: string): Promise<{url: string | null}>;
}
export async function prepareTestCheckout(args: {
  ports: CheckoutPorts; userId: string; email: string | undefined;
  plan: PlanKey; priceId: string; appUrl: string;
}): Promise<string> {
  const { ports, userId, email, plan, priceId } = args;
  const baseUrl = assertLocalAppUrl(args.appUrl);
  const current = await ports.loadExisting(userId); // Throw on DB error, never treat as absent.
  if (current && (current.status === "active" || current.status === "trialing")) {
    throw new BillingGuardError(409, "ALREADY_SUBSCRIBED");
  }
  const price = await ports.retrievePrice(priceId);
  assertTestPrice(price, priceId, plan);
  let customer: StripeCustomerView | null = null;
  if (current?.stripe_customer_id) {
    customer = await ports.retrieveCustomer(current.stripe_customer_id);
    if (!customer) throw new BillingGuardError(409, "EXISTING_CUSTOMER_MISSING");
  } else {
    const found = await ports.searchCustomers(userId);
    if (found.length > 1) throw new BillingGuardError(409, "DUPLICATE_CUSTOMERS_REQUIRE_RECONCILIATION");
    customer = found[0] ?? await ports.createCustomer(userId, email);
  }
  if (customer.livemode || customer.metadata.user_id !== userId) {
    throw new BillingGuardError(409, "CUSTOMER_OWNERSHIP_MISMATCH");
  }
  const session = await ports.createSession(customer.id, priceId, userId, plan, baseUrl);
  if (!session.url || !session.url.startsWith("https://checkout.stripe.com/")) {
    throw new BillingGuardError(502, "CHECKOUT_URL_UNAVAILABLE");
  }
  return session.url;
}
export interface WebhookPorts {
  retrieveSubscription(subscriptionId: string): Promise<StripeSubscriptionView>;
  loadExisting(userId: string): Promise<StoredSubscription | null>;
  upsertSubscription(row: SubscriptionWrite): Promise<void>;
}
export async function reconcileTestSubscription(args: {
  ports: WebhookPorts; subscriptionId: string; allowedPriceIds: readonly string[];
}): Promise<SubscriptionWrite> {
  // Fetch current Stripe state, never apply a stale event snapshot directly.
  const sub = await args.ports.retrieveSubscription(args.subscriptionId);
  if (sub.livemode || sub.id !== args.subscriptionId) {
    throw new BillingGuardError(400, "NOT_TEST_SUBSCRIPTION");
  }
  const userId = sub.metadata?.user_id;
  if (!userId || !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(userId)) {
    throw new BillingGuardError(422, "UNMAPPED_STRIPE_SUBSCRIPTION");
  }
  const items = sub.items?.data;
  if (!items || items.length !== 1) {
    throw new BillingGuardError(422, "EXPECTED_ONE_SUBSCRIPTION_ITEM");
  }
  const priceId = items[0].price?.id;
  if (!priceId || !args.allowedPriceIds.includes(priceId)) {
    throw new BillingGuardError(422, "UNRECOGNIZED_PRICE");
  }
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId || !customerId.startsWith("cus_")) {
    throw new BillingGuardError(422, "MISSING_CUSTOMER");
  }
  const unix = items[0].current_period_end;
  const periodEnd = typeof unix === "number" && Number.isFinite(unix) && unix > 0
    ? new Date(unix * 1000).toISOString() : null;
  if ((sub.status === "active" || sub.status === "trialing") && !periodEnd) {
    throw new BillingGuardError(422, "MISSING_ITEM_BILLING_PERIOD");
  }
  const current = await args.ports.loadExisting(userId);
  if (current?.stripe_customer_id && current.stripe_customer_id !== customerId) {
    throw new BillingGuardError(409, "CUSTOMER_ID_CONFLICT");
  }
  if (current?.stripe_subscription_id && current.stripe_subscription_id !== sub.id &&
      (current.status === "active" || current.status === "trialing")) {
    throw new BillingGuardError(409, "ACTIVE_SUBSCRIPTION_CONFLICT");
  }
  const row: SubscriptionWrite = {
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    price_id: priceId,
    status: sub.status,
    current_period_end: periodEnd,
  };
  await args.ports.upsertSubscription(row); // Must throw on DB error.
  return row;
}
