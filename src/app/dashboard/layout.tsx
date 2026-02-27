import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) redirect("/pricing");

  // 取 access token（MVP：从 cookie 里读，后面会换更正规方案）
  const token = (await cookies()).get("sb-access-token")?.value;

  if (!token) redirect("/login");

  const { data } = await supabaseAdmin.auth.getUser(token);
  const user = data.user;
  if (!user) redirect("/login");

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("status, current_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  const active =
    sub?.status === "active" || sub?.status === "trialing";

  if (!active) redirect("/pricing");

  return <>{children}</>;
}