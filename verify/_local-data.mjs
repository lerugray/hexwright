import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PATHS = {
  gotaProject: resolve(REPO, 'local/samples/gota/gota-project.json'),
  gotaHexgrid: resolve(REPO, 'local/samples/gota/gota-hexgrid.json'),
  nabHexsides: resolve(REPO, 'local/nab/hexsides.json'),
  nabHexgrid: resolve(REPO, 'local/nab/hexgrid.json'),
  nabProject: resolve(REPO, 'local/nab/project.json'),
  nabPalette: resolve(REPO, 'local/palettes/nab.json'),
  twuEpProject: resolve(REPO, 'local/twu-ep/project.json'),
};

/** twu-ep project must be served from the PARENT of the repo (its map path
 * escapes the repo, see "Launch Hexwright - TWU East Prussia.command"). */
export const REPO_PARENT = resolve(REPO, '..');
export const REPO_NAME = 'hexwright';

/** Manifest URL query param for the operator GotA sample (gitignored under local/). */
export const GOTA_PROJECT_URL = 'local/samples/gota/gota-project.json';

export function skipIfMissing(...paths) {
  const missing = paths.filter((p) => !existsSync(p));
  if (missing.length) {
    const rel = missing.map((p) => (p.startsWith(REPO) ? p.slice(REPO.length + 1) : p));
    console.log(`SKIP local game data not present (${rel.join(', ')})`);
    process.exit(0);
  }
}
