import { NextRequest, NextResponse } from "next/server";
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
  fetch(logUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": "dev-secret",
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

  const res =
    action === "BLOCK"
      ? new NextResponse("Blocked by SecureSite OS", { status: 403 })
      : NextResponse.next();

  // Debug headers（方便你验证）
  res.headers.set("x-securesite-action", action);
  res.headers.set("x-securesite-score", String(risk_score));
  res.headers.set("x-securesite-signals", signals.map((s) => s.type).join(",") || "NONE");

  res.cookies.set(key, String(newCount), { maxAge: 60, path: "/" });
  return res;
}