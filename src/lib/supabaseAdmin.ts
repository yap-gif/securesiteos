import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * 返回 service-role admin client
 * 如果环境变量缺失，则返回 null（避免构建时报错）
 */
export function getSupabaseAdmin() {
  if (!supabaseUrl || !/^https?:\/\//.test(supabaseUrl)) {
    return null;
  }

  if (!serviceKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}