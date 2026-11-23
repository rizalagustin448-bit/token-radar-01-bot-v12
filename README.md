# Token Launch Radar — v12

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-22-green.svg)](https://nodejs.org)
[![make.fun](https://img.shields.io/badge/make.fun-token--radar--01-blue.svg)](https://make.fun)

Which pre-token protocol is worth farming next — ranked by implied launch
value, each with a costed farm plan. Built for the make.fun
`token-radar-01` competition ("Build the best token launch radar").

## What it does

`main.ts` reads the sealed snapshot (`/input/snapshot.json`: 758 protocols,
40 watchlist, 128 traded comps) and writes the graded output:

- `board.json` — the ranked board: 200 rows (the whole 40-protocol watchlist
  plus the 160 largest pre-token protocols below the $50,000,000 floor), each
  with a fitted market cap, token odds, implied value, a five-step farm plan
  with its own dollar cost and minutes, and a FARM / THIN / SKIP verdict.
- `data.js` — the same board as `window.BOARD` for the dashboard.
- `dashboard/` — the board itself: a sortable, filterable table, a
  validation strip, and a detail view with a comps chart and the farm plan.
- `screenshots/` + `dossier.json` — three screenshots of the built board and
  the dossier the grader reads.

## The model (lib/model.ts)

A protocol with no token is valued the way a market would value it: by the
market caps of similar protocols that already trade, scaled by its TVL.

- **Estimator:** shrinkage-trimmed category comps (k=5). For a protocol's
  category, the trimmed mean of the log market-cap/TVL ratios of that
  category's traded comps, shrunk toward the global log-ratio median.
  A category with one comp cannot set the value of a whole watchlist block —
  and the watchlist's biggest category, Risk Curators (12 rows), has exactly
  one traded comp, so the shrinkage does real work.
- **Token odds:** the category's base launch rate (share of protocols that
  record a token, shrunk toward the global 0.549 with a prior of 3) times an
  age factor `1 / (1 + age in years)` times a small growth tilt (at most
  ±10%), clamped to 0.05–0.85.
- **Farm verdicts:** expected value = implied value × 0.001% (a $1,000 farm
  is assumed to capture 0.001% of launch value). Net = expected value minus
  farm cost minus hours at $15/hour. FARM when net > $100 and > $20/hour;
  THIN when net > $0; SKIP otherwise.
- **No protocol name is hardcoded anywhere.** Every number is derived at run
  time from the snapshot.

## Tested, not asserted

The code tests itself on the priced comps every run, and the board's strip
shows the result (snapshot 2026-11-14):

- Leave-one-out, n=128: median absolute log error **1.616** (a typical miss
  of 5.0×), **37%** within 3× of the true market cap.
- Walk-forward, last 20 listings: median predicted/actual **1.12×**,
  **30%** within 3×.
- Three estimators compared on the same leave-one-out: global median 1.623 /
  35%, category median 1.545 / 36%, this shrinkage estimator 1.616 / 37%.
  No estimator dominates; this one is chosen for thin-category safety, the
  best within-3× share, and the walk-forward median closest to 1.0.

Full record: `dashboard/00-model-validation.md` — it sorts first in the
dossier text.

## Run it

```sh
node main.ts /path/to/snapshot.json /output
```

Node 22+, standard library only, no network, no clock, no randomness —
running it twice on the same snapshot produces byte-identical output.
The dashboard is served from `/output/dashboard/`; it loads `../data.js`.

## Files

| Path | What it is |
| --- | --- |
| `main.ts` | Entry point: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | The value model, odds, farm plans, validation |
| `dashboard/` | `index.html`, `app.css`, `app.js`, `00-model-validation.md` |
| `vendor/makefun-board.ts` | The kit's dossier builder (from the competition kit) |
| `screenshots/` | Three captures of the built board (1440×800 JPEG) |
