// Guards against born-dead controls: any id used via this.els['...'] in src/ui.js
// must appear in the els registration list, or its addEventListener silently no-ops
// (the 2026-08-08 elevation-export incident). Zero tolerance.
import { readFileSync } from 'node:fs';
const s = readFileSync(new URL('../src/ui.js', import.meta.url), 'utf8');
const used = new Set([...s.matchAll(/this\.els\['([a-z0-9-]+)'\]/g)].map(m => m[1]));
const anchor = s.indexOf("'export-btn', 'export-popover'");
if (anchor < 0) { console.error('FAIL: registry anchor not found'); process.exit(2); }
const block = s.slice(Math.max(0, anchor - 4000), anchor + 4000);
const reg = new Set([...block.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
const missing = [...used].filter(i => !reg.has(i)).sort();
if (missing.length) {
  console.error('FAIL: els ids referenced but never registered (dead controls):', missing.join(', '));
  process.exit(1);
}
console.log(`PASS: ${used.size} els references all registered`);
