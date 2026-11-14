// Missions are data, not code (design doc Feature 11).
// Rule: every number a mission states must match a run or a cited catalog value.
// Numbers below are quoted from the team design doc with its source in a comment.

import type { PlayerSettings } from "@/components/BlinkPlayer";

export type Task =
  | { type: "read" }
  | { type: "toggle"; expect: Partial<PlayerSettings> }
  | { type: "open-tab"; tab: string }
  | { type: "choose"; options: string[]; answer: string }
  | { type: "select-source"; tags: string[]; minSignificance?: number };

export type Step = {
  text: string;
  view?: { target?: string; panel?: "compact" | "deep"; tab?: string; settings?: Partial<PlayerSettings> };
  task: Task;
  hint: string;
  why?: string;
};

export type Mission = { id: string; title: string; target: string; level: string; minutes: number; blurb: string; ready: boolean; steps: Step[] };

export const MISSIONS: Mission[] = [
  {
    id: "first-brown-dwarf",
    title: "Find your first brown dwarf",
    target: "WISE 0855",
    level: "Beginner",
    minutes: 6,
    ready: true,
    blurb: "Blink the SPHEREx images, then add a 2010 image to see it jump.",
    steps: [
      {
        text: "This is WISE 0855, one of the coldest known brown dwarfs. Press play and watch the dot in the crosshair across the SPHEREx passes.",
        view: { target: "WISE 0855", panel: "deep", tab: "blink", settings: { mode: "blink", baseline: "none" } },
        task: { type: "read" },
        hint: "Use the play button or press Space.",
      },
      {
        // Design doc Feature 3: 0.66 px per six months at 6.15"/px.
        text: "It barely moves: about two thirds of a pixel every six months. Our eyes can't catch that. Turn on Deep time to add a 2010 image from NASA's WISE.",
        task: { type: "toggle", expect: { baseline: "allwise" } },
        hint: "Find the Deep time button under the player.",
        why: "Now the first frame is from 2010, fifteen years earlier.",
      },
      {
        // Design doc Feature 3: 8.15"/yr over 15.3 years is 20.3 px.
        text: "Blink A (2010) against B (the latest pass). The cyan arrow shows where SIMBAD's proper motion says it should go. Did it jump?",
        task: { type: "choose", options: ["Yes, it jumped", "No, nothing moved"], answer: "Yes, it jumped" },
        hint: "Press Blink A ⇄ B and watch the crosshair.",
        why: "Over 15 years it moves about 20 pixels.",
      },
      {
        text: "Open Sources and click the source the app ranks for motion that has no Gaia match (Gaia-dark).",
        view: { tab: "sources" },
        task: { type: "select-source", tags: ["gaia_dark"], minSignificance: 5 },
        hint: "Cold brown dwarfs are too faint for Gaia. Look for the Gaia-dark tag near the top.",
        why: "A big, significant motion and no Gaia match: a classic brown dwarf signature.",
      },
      {
        text: "Open Spectrum. Brown dwarfs this cold have methane, which dims them near 3.3 µm. Look at the shaded CH₄ window.",
        view: { tab: "spectrum" },
        task: { type: "open-tab", tab: "spectrum" },
        hint: "The Spectrum tab is next to Sources.",
      },
      {
        text: "Read the class card. It says 'candidate' because the app ranks; people confirm. You found it the way volunteers do.",
        task: { type: "read" },
        hint: "Click a bar to see what each score is made of.",
      },
    ],
  },
  {
    id: "catch-an-asteroid",
    title: "Catch an asteroid",
    target: "Eros",
    level: "Beginner",
    minutes: 5,
    // Needs the Feb 13 2026 same-field pair in the demo pack (scripts/precache.py). Off until then.
    ready: false,
    blurb: "Two images taken hours apart. Find what slid across.",
    steps: [
      {
        // Design doc §5 and Feature 2: Eros moved about 213" in 1.53 h on 2026-02-13.
        text: "On 13 Feb 2026 SPHEREx looked at the same field twice, about an hour and a half apart. Blink the pair.",
        view: { target: "Eros", panel: "deep", tab: "blink", settings: { mode: "blink" } },
        task: { type: "read" },
        hint: "Press Blink A ⇄ B.",
      },
    ],
  },
  {
    id: "why-does-this-star-blink",
    title: "Why does this star blink?",
    target: "R Draconis",
    level: "Beginner",
    minutes: 5,
    ready: true,
    blurb: "It isn't moving. Its brightness is changing.",
    steps: [
      {
        text: "R Draconis is a Mira variable, a pulsing red giant. Play the co-adds, one per SPHEREx pass.",
        view: { target: "R Draconis", panel: "deep", tab: "blink", settings: { mode: "coadd", baseline: "none" } },
        task: { type: "read" },
        hint: "Press play.",
      },
      {
        text: "Does the star move, or does its brightness change?",
        task: { type: "choose", options: ["It moves", "Its brightness changes"], answer: "Its brightness changes" },
        hint: "Watch the crosshair: the star stays in it.",
        why: "Mira variables swell and shrink over months, so they brighten and fade.",
      },
      {
        text: "Careful: each SPHEREx exposure sees a star at a different wavelength. A star can look brighter just because the wavelength changed. Switch back to Frames and read the wavelength in each caption.",
        task: { type: "toggle", expect: { mode: "blink" } },
        hint: "Pick Frames in the view switch.",
        why: "That's the wavelength trap. Judge variability from same-wavelength frames or the spectrum.",
      },
    ],
  },
];
