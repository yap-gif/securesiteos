export type RiskSignalType =
  | "HIGH_FREQUENCY"
  | "SUSPICIOUS_PATH"
  | "BAD_UA"
  | "GEO_BLOCK"
  | "METHOD_ABUSE";

export type DecisionExplanationObject = {
  site_id: string | null;
  ip: string;
  path: string;
  method: string;
  ua: string;
  // weight: 0..1，代表 Top3 权重分布（归一化后）
  signals: { type: RiskSignalType; weight: number; detail?: string }[];
  confidence: number; // 0..1
  risk_score: number; // 0..100
  action: "ALLOW" | "BLOCK";
  created_at: string; // ISO
};

const SUSPICIOUS_PATHS = [
  "/wp-admin",
  "/wp-login.php",
  "/xmlrpc.php",
  "/.env",
  "/.git",
  "/phpmyadmin",
  "/admin",
];

const GEO_BLOCKED = new Set(["RU", "KP"]); // MVP：你后面可以改成可配置

/**
 * 说明：
 * - score_add：用于最终 risk_score（0..100）阈值决策
 * - weight_base：用于 Decision Explanation Object 的 Top3 权重分布（归一化到 0..1）
 */
type InternalSignal = {
  type: RiskSignalType;
  score_add: number; // 0..100
  weight_base: number; // 任意正数
  detail?: string;
};

export function calcRiskSignals(input: {
  path: string;
  method: string;
  ua: string;
  country?: string | null;
  tooManyRequests?: boolean;
}): { signals: DecisionExplanationObject["signals"]; risk_score: number } {
  const raw: InternalSignal[] = [];

  const p = (input.path || "").toLowerCase();
  const m = (input.method || "GET").toUpperCase();
  const ua = (input.ua || "").toLowerCase();

  // 1) 高频访问
  if (input.tooManyRequests) {
    raw.push({
      type: "HIGH_FREQUENCY",
      score_add: 40,
      weight_base: 0.40,
      detail: "Rate limit triggered",
    });
  }

  // 2) 可疑路径：直接给到 >=60，保证评分决策也能拦
  if (SUSPICIOUS_PATHS.some((x) => p.startsWith(x))) {
    raw.push({
      type: "SUSPICIOUS_PATH",
      score_add: 60,
      weight_base: 0.50,
      detail: `Suspicious path: ${input.path}`,
    });
  }

  // 3) UA 异常（MVP：空/常见扫描器/脚本）
  if (!ua || ua.includes("curl") || ua.includes("python") || ua.includes("bot")) {
    raw.push({
      type: "BAD_UA",
      score_add: 25,
      weight_base: 0.25,
      detail: `Suspicious UA: ${input.ua || "(empty)"}`,
    });
  }

  // 4) 方法滥用
  if (m === "TRACE" || m === "TRACK") {
    raw.push({
      type: "METHOD_ABUSE",
      score_add: 20,
      weight_base: 0.20,
      detail: `Blocked method: ${m}`,
    });
  }

  // 5) 地区封锁（可选）
  if (input.country && GEO_BLOCKED.has(input.country)) {
    raw.push({
      type: "GEO_BLOCK",
      score_add: 30,
      weight_base: 0.30,
      detail: `Geo blocked: ${input.country}`,
    });
  }

  const risk_score = Math.min(
    100,
    raw.reduce((acc, s) => acc + s.score_add, 0)
  );

  // Top3 + 权重归一化（0..1）
  const top = raw.sort((a, b) => b.weight_base - a.weight_base).slice(0, 3);
  const sum = top.reduce((acc, s) => acc + s.weight_base, 0) || 1;

  const signals: DecisionExplanationObject["signals"] = top.map((s) => ({
    type: s.type,
    weight: round3(s.weight_base / sum), // 0..1
    detail: s.detail,
  }));

  return { signals, risk_score };
}

export function decideAction(risk_score: number): {
  action: "ALLOW" | "BLOCK";
  confidence: number;
} {
  if (risk_score >= 60) {
    // 风险越高置信度越高，上限 0.99
    return { action: "BLOCK", confidence: Math.min(0.99, 0.60 + risk_score / 200) };
  }
  // 风险越低置信度越高，下限 0.50
  return { action: "ALLOW", confidence: Math.max(0.50, 0.90 - risk_score / 200) };
}

function round3(x: number) {
  return Math.round(x * 1000) / 1000;
}