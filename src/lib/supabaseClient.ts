import { createClient } from "@supabase/supabase-js";

function mustGet(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const supabaseUrl = mustGet("NEXT_PUBLIC_SUPABASE_URL");
const supabaseAnonKey = mustGet("NEXT_PUBLIC_SUPABASE_ANON_KEY");

// ✅ 只在浏览器/Client Components 里使用这个
export const supabase = createClient(supabaseUrl, supabaseAnonKey);