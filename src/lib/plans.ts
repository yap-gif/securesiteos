export type PlanKey = "basic" | "pro" | "enterprise";

export const PLANS: Record<
  PlanKey,
  { name: string; priceMonthly: number; features: string[] }
> = {
  basic: {
    name: "Basic",
    priceMonthly: 39,
    features: ["模板网站", "基础SEO", "SSL", "每月一次漏洞扫描（后续）"],
  },
  pro: {
    name: "Pro",
    priceMonthly: 99,
    features: ["Zero Trust 防护", "自动拦截", "AI客服（后续）", "安全报告"],
  },
  enterprise: {
    name: "Enterprise",
    priceMonthly: 299,
    features: ["实时安全分析（后续）", "Kill Chain 映射（后续）", "审计日志", "优先支持"],
  },
};