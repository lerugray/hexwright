#!/usr/bin/env node
// Converts each commission repo's raw "space-attrs-draft.json" (rules-mining
// output, arbitrary per-game field names) into hexwright-native node-attrs.json
// ({"meta":{...},"spaces":{<nodeId>:{<paletteFeatureKey>:value}}}), pre-seeding
// local/pog-attrs.json + local/ftp-attrs.json so Ray's already-researched spaces
// load pre-tagged. Reproducible: re-run any time the draft files change.
//
// Usage: node tools/convert-space-attrs.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftSpacesToNodeAttrs } from '../src/store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function convertGame({ game, draftPath, palettePath, fieldMap, outPath }) {
  const draft = readJson(draftPath);
  const palette = readJson(palettePath);
  const { spaces, skipped } = draftSpacesToNodeAttrs(draft.spaces || {}, fieldMap, palette.nodeFeatures || []);

  const doc = {
    meta: {
      version: 1,
      game,
      exported: todayStamp(),
      source: 'tools/convert-space-attrs.mjs from ' + path.relative(root, draftPath)
    },
    spaces
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');

  const totalSpaces = Object.keys(draft.spaces || {}).length;
  const taggedSpaces = Object.keys(spaces).length;
  const perFeature = {};
  for (const bucket of Object.values(spaces)) {
    for (const key of Object.keys(bucket)) perFeature[key] = (perFeature[key] || 0) + 1;
  }

  console.log(`\n=== ${game} ===`);
  console.log(`draft spaces:   ${totalSpaces}`);
  console.log(`tagged spaces:  ${taggedSpaces}`);
  console.log(`per-feature:    ${JSON.stringify(perFeature)}`);
  if (skipped.length) {
    console.log(`SKIPPED (${skipped.length}): ${skipped.map((s) => `${s.nodeId}.${s.draftKey}=${JSON.stringify(s.value)} (${s.reason})`).join('; ')}`);
  } else {
    console.log('skipped: none');
  }
  console.log(`wrote ${path.relative(root, outPath)}`);
  return { taggedSpaces, perFeature, skipped };
}

// Paths of Glory: fortress (level), vpSpace->vp (flag), capital (flag,
// value dropped), terrain (enum). `notes` carries no palette mapping — ignored.
const pog = convertGame({
  game: 'Paths of Glory',
  draftPath: path.resolve(root, '../paths-of-glory-digital/data/space-attrs-draft.json'),
  palettePath: path.resolve(root, 'palettes/pog.json'),
  outPath: path.resolve(root, 'local/pog-attrs.json'),
  fieldMap: {
    fortress: { feature: 'fortress', kind: 'level' },
    vpSpace: { feature: 'vp', kind: 'flag' },
    capital: { feature: 'capital', kind: 'flag' },
    terrain: { feature: 'terrain', kind: 'enum' }
  }
});

// For the People: port / blockadeRunnerPort / capital / resourceSpace all map to
// flags. `fort` is deliberately unmapped (6.81 adjudication: built forts are a
// dynamic counter pool, not a static map attribute — see the draft's
// _adjudication_fort note). `notes` carries no palette mapping — ignored.
const ftp = convertGame({
  game: 'For the People',
  draftPath: path.resolve(root, '../for-the-people-digital/data/space-attrs-draft.json'),
  palettePath: path.resolve(root, 'palettes/ftp.json'),
  outPath: path.resolve(root, 'local/ftp-attrs.json'),
  fieldMap: {
    port: { feature: 'port', kind: 'flag' },
    blockadeRunnerPort: { feature: 'blockade-runner', kind: 'flag' },
    capital: { feature: 'capital', kind: 'flag' },
    resourceSpace: { feature: 'resource', kind: 'flag' }
  }
});

console.log(`\nDone. PoG: ${pog.taggedSpaces} tagged / FtP: ${ftp.taggedSpaces} tagged.`);
