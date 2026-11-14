import Link from "next/link";
import { MISSIONS } from "@/content/missions";

const CONCEPTS = [
  ["Proper motion", "Nearby stars drift across the sky over years. The closer, the faster they seem to move."],
  ["Parallax", "Close objects seem to shift back and forth as Earth orbits the Sun. That wobble gives distance."],
  ["Infrared", "Light our eyes miss. Cool objects like brown dwarfs glow mostly in it."],
  ["Spectra", "Split light into colours and molecules like methane and water leave dips."],
  ["Why blinking works", "Your eye catches a jump far faster than it spots a small difference."],
];

export default function LearnPage() {
  return (
    <main className="page">
      <div className="page-inner">
        <div>
          <h2 style={{ margin: "0 0 var(--space-2)" }}>Learn</h2>
          <p className="lede">Short guided missions on the real viewer and real SPHEREx data. Each one walks you to the right view and checks what you find.</p>
        </div>
        <div className="grid-cards">
          {MISSIONS.map((m, i) => (
            <div key={m.id} className="card elev-sm" style={{ minHeight: 190 }}>
              <span className="card-kicker">Mission {i + 1} · {m.level} · {m.minutes} min</span>
              <span className="card-title">{m.title}</span>
              <p className="card-body">{m.blurb}</p>
              <span className="card-meta">Target: {m.target}</span>
              {m.ready
                ? <Link className="btn btn-primary" style={{ alignSelf: "flex-start" }} href={`/learn/${m.id}`}>Start mission</Link>
                : <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled title="Waiting on its data in the demo pack">Coming soon</button>}
            </div>
          ))}
        </div>
        <h5 style={{ margin: "var(--space-4) 0 0" }}>Ideas in one minute</h5>
        <div className="row wrap" style={{ gap: "var(--space-3)", alignItems: "stretch" }}>
          {CONCEPTS.map(([n, b]) => (
            <div key={n} className="card" style={{ flex: "1 1 180px" }}><span className="card-title" style={{ fontSize: 15 }}>{n}</span><p className="card-body">{b}</p></div>
          ))}
        </div>
        <h5 style={{ margin: "var(--space-4) 0 0" }}>Stories</h5>
        <div className="row wrap" style={{ gap: "var(--space-3)", alignItems: "stretch" }}>
          <div className="card" style={{ flex: "1 1 280px" }}><span className="card-title" style={{ fontSize: 15 }}>Pluto was found by blinking</span><p className="card-body">Two photographs of the same patch of sky, flipped back and forth. One small dot jumped.</p></div>
          <div className="card" style={{ flex: "1 1 280px" }}><span className="card-title" style={{ fontSize: 15 }}>Volunteers who find brown dwarfs</span><p className="card-body">Members of the public blinking WISE images found many faint neighbours of the Sun (Backyard Worlds).</p></div>
        </div>
      </div>
    </main>
  );
}
