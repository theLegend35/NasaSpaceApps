"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

const LINKS = [
  ["/", "Explore"],
  ["/hub", "Research hub"],
  ["/feed", "Sky feed"],
  ["/learn", "Learn"],
  ["/about", "About"],
] as const;

type Status = "checking" | "online" | "waking" | "offline";

/** Pings /health on load. Render's free tier sleeps, so the first call can be slow. */
function ServerStatus() {
  const [s, setS] = useState<Status>("checking");
  useEffect(() => {
    let done = false;
    const slow = setTimeout(() => !done && setS("waking"), 2500);
    const tryOnce = (left: number) =>
      apiGet<{ ok: boolean }>("/health")
        .then(() => { done = true; setS("online"); })
        .catch(() => (left > 0 ? setTimeout(() => tryOnce(left - 1), 5000) : setS("offline")));
    tryOnce(12);
    return () => clearTimeout(slow);
  }, []);
  const text = { checking: "Checking data server", online: "Data server online", waking: "Waking up the data server…", offline: "Data server offline" }[s];
  return <span className={s === "online" ? "tag tag-neutral" : "tag tag-outline"} role="status">{text}</span>;
}

export default function Nav() {
  const path = usePathname();
  if (path?.startsWith("/embed")) return null;
  return (
    <nav className="nav">
      <Link href="/" className="nav-brand" style={{ marginRight: "var(--space-4)", textDecoration: "none" }}>SolaraX</Link>
      <div className="nav-links">
        {LINKS.map(([href, name]) => {
          const on = href === "/" ? path === "/" : path?.startsWith(href);
          return (
            <Link key={href} href={href} className="nav-link" aria-current={on ? "page" : undefined}>{name}</Link>
          );
        })}
      </div>
      <ServerStatus />
    </nav>
  );
}
