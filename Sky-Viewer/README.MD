# SPHEREx Sky Viewer — Design Mockups

UI mockups for a public-facing web tool that shows images of the sky from NASA's SPHEREx mission and plays them back like a short video, so anyone can see how a patch of sky changes over time.

## What the tool does

1. Enter a patch of sky by **Right Ascension** and **Declination**.
2. The tool loads every SPHEREx image of that patch, in date order.
3. Images play as an animation (with play/pause, a frame scrubber and a blink mode), making moving objects and brightness changes easy to spot.

## Test targets

| Target | Why it's interesting |
|---|---|
| Barnard's Star | High proper motion — visibly moves between frames |
| Epsilon Indi B | A pair of brown dwarfs orbiting a star |
| WISE 0855 (RA 08h55m10.831s, Dec −7°14′42.53″) | Fast-moving brown dwarf |
| RW Aurigae | Variable star — brightness changes |
| R Draconis | Variable star — brightness changes |

## Status

These are **design mockups with sample data**, not the working tool yet. Open `index.html` in a browser to view them (it's a single self-contained file; JavaScript must be enabled).

Next step: build the real viewer and connect it to actual SPHEREx image cutouts.
