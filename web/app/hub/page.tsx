"use client";

// Research hub (design doc Feature 9, Preview). Real candidates from our test fields
// only; never seeded votes. Any votes shown in the demo are the team's own.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { DownloadSimple } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import SignIn, { useSession } from "@/components/SignIn";

type Candidate = { id: string; ra: number; dec: number; top_class: string; score: number; status: string; parts: unknown };
type Tally = { candidate_id: string; answer: string; weighted: number; votes: number };

const ANSWERS = [["matches", "Matches"], ["other", "It's more like something else"], ["artifact", "Looks like an image glitch"], ["cant_tell", "Can't tell"]] as const;

export default function HubPage() {
  const sb = supabase();
  const session = useSession();
  const [cands, setCands] = useState<Candidate[] | null>(null);
  const [tallies, setTallies] = useState<Tally[]>([]);
  const [i, setI] = useState(0);
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    if (!sb) return;
    const { data, error } = await sb.from("candidates").select("id,ra,dec,top_class,score,status,parts").in("status", ["open", "disputed"]).order("score", { ascending: false }).limit(50);
    if (error) { setMsg(error.message); return; }
    setCands(data as Candidate[]);
    const t = await sb.from("candidate_tallies").select("*");
    if (!t.error) setTallies(t.data as Tally[]);
  }, [sb]);
  useEffect(() => { load(); }, [load]);

  const c = cands?.[i];
  const vote = async (answer: string) => {
    if (!sb || !c) return;
    const { error } = await sb.from("votes").insert({ candidate_id: c.id, answer });
    setMsg(error ? (error.code === "23505" ? "You already voted on this one." : error.message) : "Vote recorded. Here is the next one.");
    if (!error) { setI((x) => (x + 1) % (cands?.length || 1)); load(); }
  };

  const exportCsv = () => {
    if (!cands) return;
    const rows = ["id,ra,dec,top_class,score,status", ...cands.map((x) => [x.id, x.ra, x.dec, x.top_class, x.score, x.status].join(","))];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = "solarax-candidates.csv";
    a.click();
  };

  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2 style={{ margin: "0 0 var(--space-2)" }}>Research hub <span className="tag tag-outline" style={{ verticalAlign: "middle" }}>Preview</span></h2>
          <p className="lede">Help check what the software flagged. Look at one candidate at a time and say what you see. Viewing never needs an account. Voting does.</p>
        </div>
        <SignIn why="Sign in to vote." />
        {!sb ? (
          <div className="card elev-sm state"><span className="card-kicker">Not connected</span><span className="card-title">The candidate store isn&apos;t connected yet</span>
            <p className="card-body">Candidates come from the AI vision engine runs on our test fields and are stored in Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then run supabase/schema.sql.</p></div>
        ) : !cands ? <span className="small muted">Loading candidates…</span> : !c ? (
          <div className="card elev-sm state"><span className="card-kicker">Queue empty</span><span className="card-title">No open candidates yet</span>
            <p className="card-body">They appear after the AI vision engine runs on a field. We never seed fake candidates.</p></div>
        ) : (
          <div className="row wrap" style={{ gap: "var(--space-8)", alignItems: "flex-start" }}>
            <div className="card elev-sm" style={{ flex: "1 1 460px", gap: "var(--space-4)", padding: "var(--space-6)" }}>
              <span className="card-kicker">Candidate queue · {i + 1} of {cands.length}</span>
              <span className="card-title num">{c.ra.toFixed(4)} {c.dec >= 0 ? "+" : "−"}{Math.abs(c.dec).toFixed(4)}</span>
              <span className="small" style={{ color: "var(--color-neutral-300)" }}>Software&apos;s guess: {c.top_class.replace(/_/g, " ")} · score {c.score.toFixed(0)} (candidate)</span>
              <Link className="btn btn-secondary" style={{ alignSelf: "flex-start" }} href={`/?ra=${c.ra}&dec=${c.dec}&panel=deep`}>Open in the viewer to blink it</Link>
              <div className="row wrap">
                {ANSWERS.map(([k, label], j) => (
                  <button key={k} className={j === 0 ? "btn btn-primary" : "btn btn-secondary"} disabled={!session} onClick={() => vote(k)}>{label}</button>
                ))}
              </div>
              <span className="small" style={{ color: "var(--color-accent-300)", minHeight: 18 }}>{msg}</span>
            </div>
            <div className="col" style={{ flex: "1 1 320px", gap: "var(--space-4)" }}>
              <h5 style={{ margin: 0 }}>Top candidates</h5>
              <table className="table" style={{ fontSize: 13 }}>
                <thead><tr><th>Candidate</th><th>Leading answer</th><th>Votes</th></tr></thead>
                <tbody>
                  {cands.slice(0, 8).map((x) => {
                    const t = tallies.filter((y) => y.candidate_id === x.id).sort((a, b) => b.weighted - a.weighted);
                    return <tr key={x.id}><td className="num">{x.ra.toFixed(3)} {x.dec.toFixed(3)}</td><td>{t[0]?.answer ?? "no votes yet"}</td><td className="num">{t.reduce((k, y) => k + y.votes, 0)}</td></tr>;
                  })}
                </tbody>
              </table>
              <button className="btn btn-secondary small" style={{ alignSelf: "flex-start" }} onClick={exportCsv}><DownloadSimple />CSV</button>
              <div className="card"><span className="card-kicker">Verified researchers</span><span className="card-title">Expert queue</span>
                <p className="card-body">Candidates the public and the software disagree on. ORCID sign-in (verifies who you are, not that you&apos;re an astronomer) is next.</p>
                <button className="btn btn-secondary small" style={{ alignSelf: "flex-start" }} disabled>Sign in with ORCID</button></div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
