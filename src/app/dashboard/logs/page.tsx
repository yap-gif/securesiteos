import { supabase } from "@/lib/supabaseClient";

export default async function LogsPage() {
  // 公开 anon key 不能用 service role，所以这里只做“开发可看”的最小版
  // 生产版本我们会改成：Server Action / API 用 service role + 订阅校验
  const { data, error } = await supabase
    .from("security_logs")
    .select("id, created_at, ip, path, method, action, risk_score, confidence, kill_chain_stage, signals")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-3xl font-bold">Security Logs</h1>
        <p className="text-gray-600">
          最近 50 条拦截/放行日志（MVP）。
        </p>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-4 text-red-700">
            Supabase error: {error.message}
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="p-3">Time</th>
                <th className="p-3">IP</th>
                <th className="p-3">Path</th>
                <th className="p-3">Action</th>
                <th className="p-3">Score</th>
                <th className="p-3">Kill Chain</th>
                <th className="p-3">Signals</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-3 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="p-3 whitespace-nowrap">{row.ip}</td>
                  <td className="p-3 whitespace-nowrap">
                    {row.method} {row.path}
                  </td>
                  <td className="p-3 font-semibold">{row.action}</td>
                  <td className="p-3">{row.risk_score} ({Number(row.confidence).toFixed(2)})</td>
                  <td className="p-3">{row.kill_chain_stage || "-"}</td>
                  <td className="p-3">
                    <code className="text-xs">
                      {Array.isArray(row.signals)
                        ? row.signals.map((s: any) => s.type).join(", ")
                        : JSON.stringify(row.signals)}
                    </code>
                  </td>
                </tr>
              ))}
              {!data?.length && (
                <tr>
                  <td className="p-3 text-gray-500" colSpan={7}>
                    No logs yet. Visit /wp-admin a few times to generate logs.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="text-sm text-gray-600">
          测试：访问 <code className="rounded bg-gray-100 px-1">/wp-admin</code> 会被拦截并写日志。
        </div>
      </div>
    </main>
  );
}