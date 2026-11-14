# Template spectra: sources and licenses

Owner: Science + story. Drop one CSV per template here with columns
`lambda_um,flux` (any flux units; the fit has a free scale). The file name
becomes the template name in the UI (e.g. `brown_dwarf_T.csv`).

List every file below with where it came from and its license **before** it ships.

| File | What it is | Source | License |
| --- | --- | --- | --- |
| _(none yet)_ | | | |

Candidates to check (PROPOSAL): Sonora model atmospheres for L/T/Y brown dwarfs;
a stellar library for hot/Sun-like/cool stars; an asteroid reflectance spectrum
times a solar spectrum; a galaxy template; a quasar power law.

# SPHEREx channel table

`../spherex_channels.csv` (columns `channel,lambda_min_um,lambda_max_um`) must come
from IRSA's published 102-channel definitions. Until it exists, /spectrum returns
unbinned per-exposure points and says so. Do not write guessed channel edges.
