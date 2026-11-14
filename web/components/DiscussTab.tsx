"use client";

// Discuss tab: feed posts pinned near this spot (design doc Feature 10, "Nearby").

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Post = { id: string; caption: string; ra: number; dec: number; object_tag: string | null; created_at: string; image_path: string | null };

export default function DiscussTab({ ra, dec }: { ra: number; dec: number }) {
  const sb = supabase();
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!sb) return;
    const r = 0.5; // degrees: bounding box in SQL, true distance below
    sb.from("posts").select("id,caption,ra,dec,object_tag,created_at,image_path").eq("hidden", false)
      .gte("dec", dec - r).lte("dec", dec + r).order("created_at", { ascending: false }).limit(50)
      .then(({ data, error }) => {
        if (error) { setErr(error.message); return; }
        const near = (data as Post[]).filter((p) => {
          const d = Math.hypot((p.ra - ra) * Math.cos((dec * Math.PI) / 180), p.dec - dec);
          return d <= r;
        });
        setPosts(near);
      });
  }, [sb, ra, dec]);

  if (!sb) return <p className="small muted">The sky feed isn&apos;t connected yet (no Supabase project configured). Posts about this spot will show here.</p>;
  if (err) return <p className="small" style={{ color: "var(--color-accent-300)" }}>{err}</p>;
  if (!posts) return <p className="small muted">Loading posts…</p>;
  if (!posts.length) return <p className="small muted">No posts about this spot yet. Use Export GIF, then post it from the Sky feed.</p>;
  return (
    <div className="col">
      {posts.map((p) => (
        <div key={p.id} className="card">
          <span className="card-meta">{new Date(p.created_at).toUTCString().slice(5, 16)}{p.object_tag ? ` · ${p.object_tag}` : ""}</span>
          <p className="card-body">{p.caption}</p>
        </div>
      ))}
    </div>
  );
}
