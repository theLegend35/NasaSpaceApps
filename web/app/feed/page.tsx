"use client";

// Sky feed (design doc Feature 10, Preview). Every post is pinned to a real spot;
// "Fly there" opens the viewer at the post's exact view.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Crosshair } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import SignIn from "@/components/SignIn";

type Post = { id: string; ra: number; dec: number; fov: number; caption: string; object_tag: string | null; image_path: string | null;
  created_at: string; view_state: Record<string, string> | null; comment_count?: number };

export default function FeedPage() {
  const sb = supabase();
  const [sort, setSort] = useState<"trending" | "new">("new");
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!sb) return;
    const q = sort === "trending" ? sb.from("posts_trending").select("*").limit(30)
      : sb.from("posts").select("*").eq("hidden", false).order("created_at", { ascending: false }).limit(30);
    q.then(({ data, error }) => { if (error) setErr(error.message); else setPosts(data as Post[]); });
  }, [sb, sort]);

  const img = (p: Post) => p.image_path && sb ? sb.storage.from("posts").getPublicUrl(p.image_path).data.publicUrl : null;

  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2 style={{ margin: "0 0 var(--space-2)" }}>Sky feed <span className="tag tag-outline" style={{ verticalAlign: "middle" }}>Preview</span></h2>
          <p className="lede">What people are finding. Posts come from Export GIF in the viewer, so each one links back to the exact view. No uploads from outside the app.</p>
        </div>
        <div className="row wrap">
          <div className="seg">
            <label className="seg-opt"><input type="radio" name="sort" checked={sort === "trending"} onChange={() => setSort("trending")} />Trending</label>
            <label className="seg-opt"><input type="radio" name="sort" checked={sort === "new"} onChange={() => setSort("new")} />New</label>
          </div>
          <span className="grow" />
          <SignIn why="Sign in to post and comment." />
        </div>
        {!sb ? (
          <div className="card elev-sm state"><span className="card-kicker">Not connected</span><span className="card-title">The feed isn&apos;t connected yet</span>
            <p className="card-body">Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY and run supabase/schema.sql. The team seeds it with real posts about WISE 0855, Eros and R Draconis made in the app.</p></div>
        ) : err ? <span className="small" style={{ color: "var(--color-accent-300)" }}>{err}</span>
          : !posts ? <span className="small muted">Loading…</span>
          : !posts.length ? <span className="small muted">No posts yet.</span> : (
            <div className="grid-cards">
              {posts.map((p) => {
                const src = img(p);
                return (
                  <div key={p.id} className="card elev-sm" style={{ gap: "var(--space-3)" }}>
                    {src && <img src={src} alt={p.caption} style={{ width: "100%", aspectRatio: "16/10", objectFit: "cover", borderRadius: "var(--radius-sm)", imageRendering: "pixelated" }} />}
                    {p.object_tag && <span className="tag tag-accent" style={{ alignSelf: "flex-start" }}>{p.object_tag}</span>}
                    <p className="card-body" style={{ opacity: 1, color: "var(--color-neutral-200)" }}>{p.caption}</p>
                    <span className="card-meta num">{p.ra.toFixed(3)} {p.dec.toFixed(3)} · {new Date(p.created_at).toUTCString().slice(5, 16)}</span>
                    <div className="row">
                      <Link className="btn btn-primary small" href={`/?${new URLSearchParams({ ...(p.view_state ?? {}), ra: String(p.ra), dec: String(p.dec), panel: "deep" })}`}><Crosshair />Fly there</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </main>
  );
}
