import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

type Signal = {
  type: string;
  weight: number;
  detail?: string;
};

export async function POST(req: Request) {
  // 仅允许内部 proxy 调用（MVP）
  const secret = req.headers.get("x-internal-secret");
  if (secret !== "dev-secret") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) {
    // 没配置 service role 时，不阻塞
    return NextResponse.json({ ok: true, skipped: true, reason: "no-admin" });
  }

  const body = await req.json();

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