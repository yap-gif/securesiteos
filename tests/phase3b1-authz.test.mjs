import { test } from "node:test";
import assert from "node:assert/strict";
import { hasDashboardAccess } from "../src/lib/subscriptionAccess.ts";

test("active subscription is allowed", () => assert.equal(hasDashboardAccess("active"), true));
test("trialing subscription is allowed", () => assert.equal(hasDashboardAccess("trialing"), true));
test("inactive subscription is denied", () => assert.equal(hasDashboardAccess("inactive"), false));
test("canceled subscription is denied", () => assert.equal(hasDashboardAccess("canceled"), false));
test("missing subscription is denied", () => assert.equal(hasDashboardAccess(null), false));
test("unknown subscription status is denied", () => assert.equal(hasDashboardAccess(undefined), false));
