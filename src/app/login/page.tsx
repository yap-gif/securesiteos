"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [msg, setMsg] = useState<string>("");

  async function submit() {
    setMsg("");
    if (!email || !password) return setMsg("Please enter email + password.");

    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) return setMsg(error.message);
      return setMsg("Signed up. Check your email if confirmation is enabled.");
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return setMsg(error.message);
    window.location.href = "/pricing";
  }

  return (
    <main className="min-h-screen p-8">
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-3xl font-bold">{mode === "login" ? "Log in" : "Sign up"}</h1>

        <input
          className="w-full rounded border p-3"
          placeholder="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <input
          className="w-full rounded border p-3"
          placeholder="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="w-full rounded bg-black p-3 text-white" onClick={submit}>
          {mode === "login" ? "Log in" : "Create account"}
        </button>

        <button
          className="w-full rounded border p-3"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          Switch to {mode === "login" ? "Sign up" : "Log in"}
        </button>

        {msg && <div className="rounded border p-3 text-sm">{msg}</div>}
      </div>
    </main>
  );
}