# Validation table

Every number here must come from a run (`api/scripts/precache.py` or a live call). No placeholders.
Science + story signs off on each row.

## Acceptance checks (design doc Features 7 and 8)

| Check | Expected | Measured | Run date | Pass? |
| --- | --- | --- | --- | --- |
| WISE 0855 ranks first in its field's Sources list | rank 1, tagged Gaia-dark | | | |
| Barnard's Star measured motion vs SIMBAD 10.39″/yr | agree within error | | | |
| Fixed stars stay put between frames (alignment) | within 0.3 px | | | |
| Empty patch spectrum | mostly upper limits | | | |

## Class decisions on the test targets (rules.yaml, PROPOSAL weights)

| Target | Expected label | Rule decision | Score | Notes |
| --- | --- | --- | --- | --- |
| WISE 0855 | brown dwarf | | | |
| Epsilon Indi B | brown dwarf | | | |
| Barnard's Star | high-motion star | | | |
| R Draconis | variable | | | |
| RW Aurigae | variable | | | |
| Eros | asteroid | | | |

If a target misses, don't tune the weights to force it. Log it here, discuss,
and change rules.yaml only with a written reason in the commit.

## Photometry cross-check

Compare one bright star against IRSA's SPHEREx Spectrophotometry Tool and record the difference.

| Star | λ range | SolaraX / IRSA ratio | Notes |
| --- | --- | --- | --- |
