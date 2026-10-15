# SecureSiteOS

SecureSiteOS is an experimental full-stack web application and security engineering portfolio project built with Next.js, Supabase, and Stripe.

It explores explainable HTTP request-risk scoring, security event logging, authentication, and subscription billing.

**Status:** MVP / work in progress. This is not a production-ready Zero Trust platform or a fully validated web application firewall.

## Technology Stack

- Next.js 16.1.6 (App Router)
- React 19.2.3 and TypeScript
- Tailwind CSS 4
- Supabase JavaScript SDK
- Stripe SDK

See `package.json` for dependency declarations.

## Implemented Code Paths

### Request Risk Scoring

`src/lib/security.ts` implements a rule-based risk score and an ALLOW/BLOCK decision.

Signals defined in the scoring module include:

- HIGH_FREQUENCY
- SUSPICIOUS_PATH
- BAD_UA
- GEO_BLOCK
- METHOD_ABUSE

`src/proxy.ts` connects request inspection with the scoring module. It uses request path, method, user agent, and a cookie-based request counter.

Country information is not currently passed into the scoring function by this proxy.

### Security Event Logging

`src/app/api/security/log/route.ts` handles security event ingestion and attempts to store records in the Supabase `security_logs` table.

This endpoint currently uses a hardcoded internal secret. It is not suitable for production security telemetry without additional hardening.

### Authentication

`src/app/login/page.tsx` implements client-side email/password registration and sign-in using Supabase.

`src/app/dashboard/layout.tsx` separately expects a server-readable `sb-access-token` cookie and checks subscription status.

The session handoff between these components requires further implementation and verification.

### Subscription Billing

`src/app/api/billing/checkout/route.ts` implements a Stripe Checkout Session creation endpoint with Supabase token verification.

`src/app/api/billing/webhook/route.ts` contains handlers for:

- customer.subscription.created
- customer.subscription.updated
- customer.subscription.deleted

These are code-level implementations. Complete payment lifecycle and webhook database persistence have not been independently verified.

### Dashboard and Logs

- `/dashboard` currently provides an MVP overview and placeholder content.
- `/dashboard/logs` attempts to display recent security log records.
- Database access is subject to the actual Supabase configuration and row-level security policies.

## Local Development

### Requirements

- Node.js 20.9 or later
- npm
- Supabase project
- Stripe test account for billing functionality

### Environment Configuration

Create `.env.local` in the project root. Required and referenced configuration includes:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace_me
SUPABASE_SERVICE_ROLE_KEY=replace_me

STRIPE_SECRET_KEY=sk_test_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_PRICE_BASIC=price_replace_me
STRIPE_PRICE_PRO=price_replace_me
STRIPE_PRICE_ENTERPRISE=price_replace_me

NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Replace placeholders with your own development credentials.

Never commit `.env.local` or expose service-role and Stripe secret keys in client-side code.

### Install and Run

```powershell
npm ci
npm run dev
```

Open http://localhost:3000.

A working Supabase schema, suitable RLS policies, valid credentials, and Stripe configuration are required for relevant functionality. Database migration files are not currently included in this repository.

## Verification

Available npm scripts:

```powershell
npm run lint
npm run build
```

The repository currently has no dedicated automated test script in `package.json`.

These commands must be executed before claiming that a build or quality gate has passed.

## Known Limitations and Technical Debt

- Hardcoded internal authentication secret for security logging.
- Broad proxy matcher and potential internal request re-entry.
- Cookie-based request counting is not reliable distributed rate limiting.
- Client-side authentication session is not synchronized with the dashboard's expected cookie flow.
- Security log access depends on external Supabase RLS configuration.
- Stripe webhook database errors are not consistently surfaced.
- Debug security headers are exposed in responses.
- No committed Supabase schema migrations.
- No automated unit or integration test suite.

These items are documented engineering work, not resolved security controls.

## Project Scope

SecureSiteOS demonstrates early-stage full-stack and defensive application engineering concepts. Further security hardening, integration testing, and operational validation are required before production use.