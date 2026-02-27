import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-4xl font-bold">SecureSite OS</h1>
        <p className="text-lg text-gray-600">
          一键生成自带 Zero-Trust 防护的安全型网站（SaaS MVP）
        </p>

        <div className="flex gap-3">
          <Link className="rounded-md bg-black px-4 py-2 text-white" href="/pricing">
            查看订阅方案
          </Link>
          <Link className="rounded-md border px-4 py-2" href="/dashboard">
            进入后台
          </Link>
        </div>

        <div className="rounded-lg border p-4">
          <p className="font-medium">MVP 已包含：</p>
          <ul className="list-disc pl-6 text-gray-700">
            <li>Next.js SSR（SEO 友好）</li>
            <li>Zero-Trust Lite（Edge Middleware 拦截）</li>
            <li>Decision Explanation Object（拦截解释对象）</li>
            <li>安全日志写入（Supabase 表）</li>
            <li>Stripe 订阅（下一步接入）</li>
          </ul>
        </div>
      </div>
    </main>
  );
}