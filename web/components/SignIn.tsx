"use client";

// Email magic-link sign-in (Supabase Auth). Viewing never needs an account.

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export function useSession(): Session | null {
  const sb = supabase();
  const [s, setS] = useState<Session | null>(null);
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setS(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, session) => setS(session));
    return () => data.subscription.unsubscribe();
  }, [sb]);
  return s;
}

export default function SignIn({ why }: { why: string }) {
  const sb = supabase();
  const session = useSession();
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState("");
  if (!sb) return <span className="small muted">Accounts aren&apos;t connected yet (no Supabase project configured).</span>;
  if (session) return (
    <div className="row small"><span className="muted">Signed in</span>
      <button className="btn btn-ghost small" onClick={() => sb.auth.signOut()}>Sign out</button></div>
  );
  return (
    <form className="row wrap" onSubmit={async (e) => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
      setMsg(error ? error.message : "Check your email for a sign-in link.");
    }}>
      <label className="sr-only" htmlFor="email">Email</label>
      <input id="email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" style={{ width: 220 }} />
      <button className="btn btn-primary">Email me a link</button>
      <span className="small muted">{msg || why}</span>
    </form>
  );
}
