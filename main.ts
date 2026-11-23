// main.ts — token launch radar entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, builds the ranked board with lib/model.ts, and
// writes the graded output:
//   /output/board.json   the ranked board (rows + model record)
//   /output/data.js      the same board as window.BOARD for the dashboard
//   /output/dashboard/  a copy of dashboard/
//   /output/screenshots/ a copy of screenshots/
//   /output/dossier.json buildDossier output (only when screenshots exist)
//
// Fully deterministic: no clocks, no randomness, no network. The snapshot's
// own as_of is the only date anywhere in the output.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { buildBoard, type Snapshot } from './lib/model.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2] ?? process.env.MAKEFUN_INPUT ?? '/input/snapshot.json';
const outDir = process.argv[3] ?? process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const snap = JSON.parse(readFileSync(inputPath, 'utf8')) as Snapshot;
const { rows, validation, fitted, comp_log_ratios } = buildBoard(snap);

const board = {
  as_of: snap.as_of,
  rows,
  model: {
    name: 'shrinkage-trimmed category comps, k=5, with token odds',
    validation,
    fitted,
    comps_by_category: comp_log_ratios,
    assumptions: [
      'A $1,000 farm is assumed to capture 0.001% of launch value; re-scale to your own size.',
      'Time is valued at $15 an hour; gas is typical cost at the snapshot date, rounded.',
      'A protocol is said to record no token, never that it has none.',
    ],
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), JSON.stringify(board, null, 2) + '\n');
writeFileSync(join(outDir, 'data.js'), `window.BOARD = ${JSON.stringify(board)};\n`);
cpSync(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'), { recursive: true });

const shotsDir = join(repoRoot, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).filter((f) => !f.startsWith('.')) : [];
if (shots.length > 0) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
  const dossier = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of rows) verdicts[r.verdict]++;
  console.log(`rows=${rows.length} watchlist=${rows.filter((r) => r.is_watchlist).length} verdicts=${JSON.stringify(verdicts)}`);
  console.log(`dossier=${dossier.length} bytes screenshots=${shots.join(',')}`);
} else {
  console.log(`rows=${rows.length} (no screenshots yet — dossier skipped, local dev only)`);
}
