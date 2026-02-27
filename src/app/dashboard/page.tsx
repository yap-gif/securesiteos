export default function Dashboard() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-gray-600">
          MVP 后台：下一步会显示安全日志、拦截次数、Top 攻击路径等。
        </p>

        <div className="rounded-lg border p-4">
          <p className="font-medium">当前状态：</p>
          <ul className="list-disc pl-6 text-gray-700">
            <li>Zero-Trust Lite 已启用（middleware）</li>
            <li>日志写入 API 已启用（/api/security/log）</li>
            <li>Supabase 表未配置时会跳过写入（不影响访问）</li>
          </ul>
        </div>

        <div className="rounded-lg border p-4 text-sm text-gray-600">
          你现在可以打开任意页面多刷新几次，然后访问一个可疑路径例如：
          <code className="mx-1 rounded bg-gray-100 px-1">/wp-admin</code>
          你会看到 403 Blocked。
        </div>
      </div>
    </main>
  );
}