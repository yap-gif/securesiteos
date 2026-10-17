export function hasDashboardAccess(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing";
}
