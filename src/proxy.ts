import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { calcRiskSignals, decideAction } from "./lib/security";

export const config = {
  matcher: ["/:path*"],
};

function getIP(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "0.0.0.0"
  );
}

export default async function proxy(req: NextRequest) {
  const ip = getIP(req);
  const path = req.nextUrl.pathname;

  // Direct telemetry requests must not generate further telemetry requests.
  if (
    path === "/api/security/log" ||
    path.startsWith("/api/security/log/") ||
    path.startsWith("/_next/") ||
    path === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const ua = req.headers.get("user-agent") || "";
  const method = req.method;

  // ✅ proxy 运行测试入口（保留）
  if (path === "/__proxy_test") {
    return new NextResponse("PROXY OK", { status: 200 });
  }

  // MVP: 简化限流（cookie计数，60秒窗口）
  const key = `rl_${ip}`;
  const cookie = req.cookies.get(key)?.value;
  const count = cookie ? Number(cookie) : 0;
  const newCount = count + 1;

  const tooManyRequests = newCount > 60;

  const { signals, risk_score } = calcRiskSignals({
    path,
    ua,
    method,
    tooManyRequests,
  });

  let { action, confidence } = decideAction(risk_score);

  // ✅ MVP 策略：命中可疑路径（SUSPICIOUS_PATH）直接 BLOCK
  if (signals.some((s) => s.type === "SUSPICIOUS_PATH")) {
    action = "BLOCK";
    confidence = Math.max(confidence, 0.9);
  }

  // ✅ 异步记录日志（不阻塞请求）
  const logUrl = new URL("/api/security/log", req.url);
  const telemetrySecret = process.env.INTERNAL_TELEMETRY_SECRET;
  if (telemetrySecret && telemetrySecret.trim().length >= 32) {
    fetch(logUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": telemetrySecret,
    },
    body: JSON.stringify({
      site_id: null,
      ip,
      path,
      method,
      ua,
      signals,
      risk_score,
      confidence,
      action,
      // 先给一个简单 Kill Chain stage（MVP）
      kill_chain_stage: signals.some((s) => s.type === "SUSPICIOUS_PATH")
        ? "Delivery"
        : "Reconnaissance",
    }),
    }).catch(() => {});
  }

  // Do not forward a caller-supplied internal authentication header to app routes.
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.delete("x-internal-secret");
  let res =
    action === "BLOCK"
      ? new NextResponse("Blocked by SecureSite OS", { status: 403 })
      : NextResponse.next({ request: { headers: forwardedHeaders } });

  // Refresh Supabase cookies for protected dashboard requests only.
  // DashboardLayout independently verifies both user identity and subscription.
  if (action !== "BLOCK" && (path === "/dashboard" || path.startsWith("/dashboard/"))) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anonKey) {
      const server = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
            const refreshedHeaders = new Headers(req.headers);
            refreshedHeaders.delete("x-internal-secret");
            const precedingCookies = res.cookies.getAll();
            res = NextResponse.next({ request: { headers: refreshedHeaders } });
            precedingCookies.forEach((cookie) => res.cookies.set(cookie));
            cookiesToSet.forEach(({ name, value, options }) =>
              res.cookies.set(name, value, options)
            );
          },
        },
      });
      try {
        await server.auth.getUser();
      } catch {
        // Never grant access on refresh failure: the dashboard layout rejects it.
      }
    }
  }

  // Debug headers（方便你验证）
  res.headers.set("x-securesite-action", action);
  res.headers.set("x-securesite-score", String(risk_score));
  res.headers.set("x-securesite-signals", signals.map((s) => s.type).join(",") || "NONE");

  res.cookies.set(key, String(newCount), { maxAge: 60, path: "/" });
  return res;
}