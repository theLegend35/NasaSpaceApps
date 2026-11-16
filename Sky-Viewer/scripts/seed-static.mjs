// Copies cache-seed/ into public/seed/ so the site serves saved lookups and previews as static files.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const seed = join(root, "cache-seed");
const out = join(root, "public", "seed");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const index = { lookups: [], previews: [], scores: [], targets: [] };
for (const [folder, suffix] of [["lookups", ".json"], ["previews", ".png"], ["scores", ".json"]]) {
  const from = join(seed, folder);
  if (!existsSync(from)) continue;
  const names = readdirSync(from).filter((name) => name.endsWith(suffix));
  if (suffix === ".png") {
    cpSync(from, join(out, folder), { recursive: true });
  } else {
    // Python writes NaN and Infinity, which browsers reject as JSON. Publish them as null.
    mkdirSync(join(out, folder), { recursive: true });
    for (const name of names) {
      const text = readFileSync(join(from, name), "utf8")
        .replace(/(:\s*)(-?Infinity|NaN)(?=\s*[,}\]])/g, "$1null")
        .replace(/([[,]\s*)(-?Infinity|NaN)(?=\s*[,\]])/g, "$1null");
      JSON.parse(text);
      writeFileSync(join(out, folder, name), text);
    }
  }
  index[folder] = names.map((name) => name.slice(0, -suffix.length));
}
const targets = join(seed, "targets.json");
if (existsSync(targets)) index.targets = JSON.parse(readFileSync(targets, "utf8"));

writeFileSync(join(out, "index.json"), JSON.stringify(index));
console.log(`seed: ${index.lookups.length} lookups, ${index.previews.length} previews, ${index.scores.length} scores, ${index.targets.length} targets`);
