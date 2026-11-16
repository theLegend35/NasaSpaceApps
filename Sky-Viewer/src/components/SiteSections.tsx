"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, ArrowRight, Crosshair, Globe, Play } from "lucide-react";
import { fetchCachedLookup, type KnownTarget } from "../lib/spherex";

type SectionProps = {
  knownTargets: KnownTarget[];
  onOpenTarget: (targetId: string) => void;
  onExplore: () => void;
};

const previewUrl = (cutoutUrl: string) => `/api/point/image?cutout_url=${encodeURIComponent(cutoutUrl)}`;

/** Real cached SPHEREx previews for each saved target (first, middle and last image by date). */
function useTargetPreviews(targets: KnownTarget[]) {
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let active = true;
    for (const target of targets) {
      fetchCachedLookup(target.ra, target.dec, 0.1, "2")
        .then((cached) => {
          if (!active || !cached || cached.measurements.length === 0) return;
          const frames = [...cached.measurements].sort((a, b) => a.time_mjd - b.time_mjd);
          const picks = [frames[0], frames[Math.floor(frames.length / 2)], frames[frames.length - 1]];
          setPreviews((current) => ({ ...current, [target.id]: picks.map((m) => previewUrl(m.cutout_url)) }));
        })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [targets]);
  return previews;
}

function Preview({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  return src
    ? <img className={`sec-img ${className ?? ""}`} src={src} alt={alt} draggable={false} />
    : <span className={`sec-img sec-img-empty ${className ?? ""}`} role="img" aria-label={`${alt} (not cached yet)`} />;
}

/* ===================== Research hub ===================== */

const CANDIDATES = [
  { name: "Candidate 014", guess: "brown dwarf", targetId: "wise-0855" },
  { name: "Candidate 027", guess: "fast-moving star", targetId: "barnards-star" },
  { name: "Candidate 031", guess: "star that changes brightness", targetId: "r-draconis" },
];
const ANSWERS = ["Matches", "It's more like something else", "Looks like an image glitch", "Can't tell"];

export function ResearchHub({ knownTargets, onOpenTarget }: SectionProps) {
  const previews = useTargetPreviews(knownTargets);
  const [index, setIndex] = useState(0);
  const [side, setSide] = useState<"a" | "b">("a");
  const [blinking, setBlinking] = useState(false);
  const [votes, setVotes] = useState<Record<string, Record<string, number>>>({});
  const [message, setMessage] = useState("");
  const candidate = CANDIDATES[index];
  const frames = previews[candidate.targetId] ?? [];

  useEffect(() => {
    if (!blinking) return;
    const timer = window.setInterval(() => setSide((s) => (s === "a" ? "b" : "a")), 500);
    return () => window.clearInterval(timer);
  }, [blinking]);

  function vote(answer: string) {
    setVotes((current) => {
      const forCandidate = { ...(current[candidate.name] ?? {}) };
      forCandidate[answer] = (forCandidate[answer] ?? 0) + 1;
      return { ...current, [candidate.name]: forCandidate };
    });
    setIndex((i) => (i + 1) % CANDIDATES.length);
    setSide("a");
    setBlinking(false);
    setMessage(`Vote recorded in this browser only. Here is the next one.`);
  }

  return (
    <section className="sec-page" aria-labelledby="hub-title">
      <div className="sec-intro">
        <h2 id="hub-title">Research hub</h2>
        <p>Help check what the software flagged. Look at one candidate at a time and say what you see. Viewing never needs an account. Voting does.</p>
      </div>
      <div className="sec-split">
        <div className="sec-card sec-card-lg">
          <div className="sec-row">
            <span className="sec-kicker">Candidate queue · {index + 1} of {CANDIDATES.length}</span>
            <span className="sec-tag">Placeholder candidate</span>
          </div>
          <div className="hub-body">
            <div className="hub-image">
              <Preview src={side === "a" ? frames[0] : frames[2]} alt={`${candidate.name}, image ${side.toUpperCase()}`} />
              <span className="sec-tag sec-tag-accent hub-side">{side.toUpperCase()}</span>
            </div>
            <div className="hub-info">
              <span className="sec-card-title">{candidate.name}</span>
              <span className="sec-muted">Software&apos;s guess: {candidate.guess}, likely</span>
              <span className="sec-faint">Confidence score appears here once measured.</span>
              <button type="button" className={`tv-blink${blinking ? " is-on" : ""}`} disabled={frames.length === 0} onClick={() => setBlinking((b) => !b)}>
                <ArrowLeftRight size={17} /> {blinking ? "Stop blinking" : "Blink A ⇄ B"}
              </button>
              <button type="button" className="tv-ghost hub-open" onClick={() => onOpenTarget(candidate.targetId)}>Open in target view <ArrowRight size={14} /></button>
              <span className="sec-faint">Known look-alikes of this type</span>
              <div className="hub-lookalikes">
                {knownTargets.filter((t) => t.id !== candidate.targetId).slice(0, 3).map((t) => (
                  <Preview key={t.id} src={previews[t.id]?.[1]} alt={t.name} />
                ))}
              </div>
            </div>
          </div>
          <div className="sec-actions">
            {ANSWERS.map((answer, i) => (
              <button key={answer} type="button" className={i === 0 ? "sec-btn sec-btn-primary" : "sec-btn"} onClick={() => vote(answer)}>{answer}</button>
            ))}
          </div>
          <span className="sec-note" aria-live="polite">{message}</span>
        </div>

        <div className="sec-side">
          <h3>Top candidates</h3>
          <div className="tv-table">
            <table>
              <thead><tr><th>Candidate</th><th>Leading answer</th><th>Votes</th></tr></thead>
              <tbody>
                {CANDIDATES.map((c) => {
                  const counts = votes[c.name] ?? {};
                  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
                  const leading = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
                  return (
                    <tr key={c.name} onClick={() => onOpenTarget(c.targetId)}>
                      <td>{c.name}</td>
                      <td>{leading ?? c.guess}</td>
                      <td>{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="sec-card">
            <span className="sec-kicker">Verified researchers</span>
            <span className="sec-card-title">Expert queue</span>
            <p className="sec-muted">Candidates the public and the software disagree on. Researchers can confirm or relabel them.</p>
            <button type="button" className="sec-btn" disabled title="Sign-in is not built yet">Sign in with ORCID</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ===================== Sky feed ===================== */

const POSTS = [
  { targetId: "wise-0855", initials: "MK", user: "skywatcher_mk", tag: "Candidate mover", caption: "Watch the dot near the centre between May and November.", comments: 12, order: 1 },
  { targetId: "barnards-star", initials: "JR", user: "jr_observes", tag: "Fast star", caption: "It really does slide across the field over a year.", comments: 5, order: 3 },
  { targetId: "r-draconis", initials: "AL", user: "astro_lena", tag: "Changes brightness", caption: "Not moving, but compare how bright it is in each visit.", comments: 8, order: 2 },
];

export function SkyFeed({ knownTargets, onOpenTarget }: SectionProps) {
  const previews = useTargetPreviews(knownTargets);
  const [sort, setSort] = useState<"Trending" | "New">("Trending");
  const [following, setFollowing] = useState<Record<string, boolean>>({});
  const posts = useMemo(
    () => [...POSTS].sort((a, b) => (sort === "Trending" ? b.comments - a.comments : b.order - a.order)),
    [sort],
  );

  return (
    <section className="sec-page" aria-labelledby="feed-title">
      <div className="sec-intro">
        <h2 id="feed-title">Sky feed</h2>
        <p>What people are finding. Every post comes from the Share button in the viewer, so each one links back to the exact view.</p>
      </div>
      <div className="sec-row sec-row-start">
        <div className="tv-seg" role="group" aria-label="Sort posts">
          {(["Trending", "New"] as const).map((option) => (
            <button key={option} type="button" aria-pressed={sort === option} onClick={() => setSort(option)}>{option}</button>
          ))}
        </div>
        <span className="sec-tag">Placeholder posts</span>
      </div>
      <div className="sec-grid">
        {posts.map((post) => {
          const target = knownTargets.find((t) => t.id === post.targetId);
          return (
            <article key={post.user} className="sec-card">
              <Preview className="sec-img-wide" src={previews[post.targetId]?.[0]} alt={target?.name ?? post.tag} />
              <div className="feed-meta">
                <span className="feed-avatar" aria-hidden="true">{post.initials}</span>
                {post.user}
                <span className="sec-tag sec-tag-accent">{post.tag}</span>
              </div>
              <p className="feed-caption">{post.caption}</p>
              <span className="sec-faint">{target?.name ?? "Saved target"} · {post.comments} comments</span>
              <div className="sec-actions">
                <button type="button" className="sec-btn sec-btn-primary" onClick={() => onOpenTarget(post.targetId)}><Crosshair size={15} /> Fly there</button>
                <button type="button" className="sec-btn" aria-pressed={Boolean(following[post.user])} onClick={() => setFollowing((f) => ({ ...f, [post.user]: !f[post.user] }))}>
                  {following[post.user] ? "Following" : "Follow"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

/* ===================== Learn ===================== */

const MISSIONS = [
  { title: "Find your first brown dwarf", target: "WISE 0855", targetId: "wise-0855", body: "Blink the images, then compare an early one with a late one to see it jump." },
  { title: "Catch an asteroid", target: "Eros", targetId: null, body: "Two images taken hours apart. Find what slid across." },
  { title: "Why does this star blink?", target: "R Draconis", targetId: "r-draconis", body: "It isn't moving. Its brightness is changing." },
];
const CONCEPTS = [
  ["Proper motion", "Nearby stars drift across the sky over years."],
  ["Parallax", "Close objects seem to shift as Earth orbits the Sun."],
  ["Infrared", "Light our eyes miss. Cool objects glow in it."],
  ["Spectra", "Light split into colors shows what something is made of."],
  ["Why blinking works", "Your eye catches a jump far faster than a difference."],
];

export function Learn({ onOpenTarget }: SectionProps) {
  return (
    <section className="sec-page" aria-labelledby="learn-title">
      <div className="sec-intro">
        <h2 id="learn-title">Learn</h2>
        <p>Short guided missions on the real viewer. Each one walks you to the right view and checks what you find.</p>
      </div>
      <div className="sec-grid">
        {MISSIONS.map((mission, i) => (
          <div key={mission.title} className="sec-card sec-card-mission">
            <span className="sec-kicker">Mission {i + 1} · Beginner</span>
            <span className="sec-card-title">{mission.title}</span>
            <p className="sec-muted">{mission.body}</p>
            <span className="sec-faint">Target: {mission.target}</span>
            {mission.targetId ? (
              <button type="button" className="sec-btn sec-btn-primary" onClick={() => onOpenTarget(mission.targetId)}><Play size={15} /> Start mission</button>
            ) : (
              <button type="button" className="sec-btn" disabled>Not available yet</button>
            )}
          </div>
        ))}
      </div>
      <h3>Ideas in one minute</h3>
      <div className="sec-flex">
        {CONCEPTS.map(([name, body]) => (
          <div key={name} className="sec-card sec-card-sm"><span className="sec-card-title">{name}</span><p className="sec-muted">{body}</p></div>
        ))}
      </div>
      <h3>Stories</h3>
      <div className="sec-flex">
        <div className="sec-card sec-card-md"><span className="sec-card-title">Pluto was found by blinking</span><p className="sec-muted">Two photographs, one small dot that jumped.</p></div>
        <div className="sec-card sec-card-md"><span className="sec-card-title">Volunteers who found brown dwarfs</span><p className="sec-muted">How members of the public spotted faint neighbours of the Sun.</p></div>
      </div>
    </section>
  );
}

/* ===================== About ===================== */

export function About({ onExplore }: SectionProps) {
  return (
    <section className="sec-page sec-narrow" aria-labelledby="about-title">
      <h2 id="about-title">See how any patch of sky changes over time</h2>
      <p className="sec-lead">Space telescopes photograph the same places again and again. This tool lines those photographs up so anyone can play them back and spot what moved or changed.</p>
      <div className="about-steps">
        <div><Globe size={26} /><h3>1. Pick a spot</h3><p>Spin the globe, search a name or type coordinates.</p></div>
        <div><Play size={26} /><h3>2. Play the images</h3><p>Every image of that spot, in date order, like a short film.</p></div>
        <div><ArrowLeftRight size={26} /><h3>3. Blink two of them</h3><p>Flip between two dates. Stars stay put. Movers jump.</p></div>
      </div>
      <h3>Three promises</h3>
      <ul className="about-list">
        <li>We call things candidates, never discoveries.</li>
        <li>Every number shown is fetched or measured. Anything else is labelled as a placeholder.</li>
        <li>Looking never needs an account.</li>
      </ul>
      <h3>Where the data comes from</h3>
      <p>Each lookup asks NASA/IPAC&apos;s IRSA archive for the SPHEREx images that cover the spot, then measures the brightness at that exact position in every image. Results are cached, so a spot someone has already loaded opens instantly.</p>
      <h3>Link straight to a spot</h3>
      <p>Add a position to the address, like <code>?ra=133.795&amp;dec=-7.245</code>, and the tool opens on that target. The same address can be embedded in another website.</p>
      <h3>Built with</h3>
      <p>IRSA&apos;s TAP and SIA services through astroquery and PyVO, Astropy for reading the images, Redis for caching, and a FastAPI backend behind this Next.js viewer.</p>
      <button type="button" className="sec-btn sec-btn-primary sec-btn-lg" onClick={onExplore}>Start exploring <ArrowRight size={16} /></button>
    </section>
  );
}
