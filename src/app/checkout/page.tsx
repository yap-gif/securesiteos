import Link from "next/link";

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-2xl font-bold">Checkout</h1>
        <p className="text-gray-600">
          你选择了套餐：<b>{plan || "未选择"}</b>
        </p>

        <div className="rounded-lg border p-4 text-gray-700">
          <p>下一步我们会做：</p>
          <ol className="list-decimal pl-6">
            <li>创建 Stripe Product / Price</li>
            <li>API Route 创建 Checkout Session</li>
            <li>Webhook 写入订阅状态到 Supabase</li>
            <li>Dashboard 根据订阅解锁功能</li>
          </ol>
        </div>

        <Link className="underline" href="/pricing">
          返回定价页
        </Link>
      </div>
    </main>
  );
}