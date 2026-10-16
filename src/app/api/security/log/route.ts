import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Signal = {
  type: string;
  weight: number;
  detail?: string;
};

export async function POST(req: Request) {
  // 仅允许内部 proxy 调用（MVP）
  const configuredSecret = process.env.INTERNAL_TELEMETRY_SECRET;
  if (!configuredSecret || configuredSecret.trim().length < 32) {
    return NextResponse.json({ error: "Telemetry authentication is not configured" }, { status: 503 });
  }
  const providedSecret = req.headers.get("x-internal-secret") ?? "";
  const expectedBytes = Buffer.from(configuredSecret, "utf8");
  const providedBytes = Buffer.from(providedSecret, "utf8");
  if (expectedBytes.length !== providedBytes.length ||
      !timingSafeEqual(expectedBytes, providedBytes)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Telemetry storage is not configured" }, { status: 503 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const validSignals = Array.isArray(body.signals) && body.signals.length <= 5 &&
    body.signals.every((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const signal = item as Record<string, unknown>;
      return typeof signal.type === "string" && signal.type.length > 0 && signal.type.length <= 64 &&
        typeof signal.weight === "number" && Number.isFinite(signal.weight) &&
        signal.weight >= 0 && signal.weight <= 1 &&
        (signal.detail === undefined || (typeof signal.detail === "string" && signal.detail.length <= 1024));
    });
  if (
    typeof body.ip !== "string" || !body.ip || body.ip.length > 128 ||
    typeof body.path !== "string" || !body.path || body.path.length > 2048 ||
    typeof body.method !== "string" || !body.method || body.method.length > 16 ||
    typeof body.ua !== "string" || !body.ua || body.ua.length > 1024 ||
    (body.action !== "ALLOW" && body.action !== "BLOCK") ||
    typeof body.risk_score !== "number" || !Number.isInteger(body.risk_score) ||
    body.risk_score < 0 || body.risk_score > 100 ||
    typeof body.confidence !== "number" || !Number.isFinite(body.confidence) ||
    body.confidence < 0 || body.confidence > 1 ||
    !validSignals ||
    (body.site_id != null && typeof body.site_id !== "string") ||
    (body.kill_chain_stage != null && typeof body.kill_chain_stage !== "string")
  ) {
    return NextResponse.json({ error: "Invalid telemetry fields" }, { status: 400 });
  }

  const site_id = body.site_id ?? null;
  const ip = String(body.ip ?? "");
  const path = String(body.path ?? "");
  const method = String(body.method ?? "GET");
  const ua = String(body.ua ?? "");
  const action = String(body.action ?? "ALLOW");
  const risk_score = Number(body.risk_score ?? 0);
  const confidence = Number(body.confidence ?? 0);
  const kill_chain_stage = body.kill_chain_stage ? String(body.kill_chain_stage) : null;

  const signals: Signal[] = Array.isArray(body.signals) ? body.signals : [];

  if (!ip || !path || !ua || !method) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }

  const { error } = await supabaseAdmin.from("security_logs").insert({
    site_id,
    ip,
    path,
    method,
    ua,
    action,
    risk_score,
    confidence,
    signals,
    kill_chain_stage,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}