// Groups feature check: store CRUD, export/import round-trip, undo/redo,
// delete-safety, and UI create-from-selection + two-step delete.
import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { skipIfMissing, GOTA_PROJECT_URL, PATHS } from './_local-data.mjs';

skipIfMissing(PATHS.gotaProject);

const DIR = process.cwd();
const PORT = 8028;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: DIR, stdio: 'ignore' });
await sleep(1300);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
const results = [];
const rec = (n, ok, note = '') => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${note ? '  — ' + note : ''}`); };

function assert(cond, msg) { if (!cond) throw new Error(msg); }

try {
  await page.goto(`http://localhost:${PORT}/?project=${GOTA_PROJECT_URL}`, { waitUntil: 'load', timeout: 20000 });
  await page.waitForFunction(() => { const el = document.getElementById('count-land'); return el && /[1-9]/.test(el.textContent); }, { timeout: 25000 });
  await sleep(1500);

  // Store-level round-trip and safety checks.
  const storeOut = await page.evaluate(async () => {
    const out = {};
    const hw = window.hexwright, store = hw.store;
    if (store.palettePromise) { try { await store.palettePromise; } catch (e) {} }
    const st = () => store.state;

    out.methods = {
      createGroup: typeof store.createGroup,
      updateGroup: typeof store.updateGroup,
      deleteGroup: typeof store.deleteGroup,
      addHexToGroup: typeof store.addHexToGroup,
      removeHexFromGroup: typeof store.removeHexFromGroup,
      getGroups: typeof store.getGroups,
      getGroup: typeof store.getGroup,
      getGroupsForHex: typeof store.getGroupsForHex
    };

    const terr = st().terrain?.terrain || {};
    const codes = Object.keys(terr).slice(0, 4);
    out.codes = codes;

    try {
      const id = store.createGroup({ name: 'Test Group', kind: 'vp', value: '2', hexes: codes.slice(0, 2) });
      out.createdId = id;
      const g = store.getGroup(id);
      out.createdShape = { id: g.id, name: g.name, kind: g.kind, value: g.value, hexes: g.hexes };
      store.updateGroup(id, { name: 'Renamed', kind: 'objective', value: '5' });
      out.updated = store.getGroup(id);
      store.addHexToGroup(id, codes[2]);
      out.afterAdd = store.getGroup(id).hexes;
      store.removeHexFromGroup(id, codes[0]);
      out.afterRemove = store.getGroup(id).hexes;

      const exported = store.exportProjectObject();
      out.exportedGroups = exported.groups;
      out.exportedHasShape = exported.groups[0]?.id === id && exported.groups[0]?.name === 'Renamed';

      // Delete group must not touch terrain.
      const landBefore = Object.keys(st().terrain.terrain || {}).length;
      store.deleteGroup(id);
      const landAfter = Object.keys(st().terrain.terrain || {}).length;
      out.landBefore = landBefore;
      out.landAfter = landAfter;
      out.groupGone = !store.getGroup(id);

      // Undo restores group; redo removes it again.
      store.undo();
      out.undoRestored = !!store.getGroup(id);
      store.redo();
      out.redoRemoved = !store.getGroup(id);

      // Re-create and reload via loadProject to prove round-trip.
      const id2 = store.createGroup({ name: 'Round', kind: 'vp', value: '1', hexes: codes.slice(1, 3) });
      const payload = store.exportProjectObject();
      store.loadProject(payload);
      const reloaded = store.getGroup(id2);
      out.roundTrip = reloaded ? { id: reloaded.id, name: reloaded.name, hexes: reloaded.hexes } : null;
    } catch (e) {
      out.err = String(e);
    }
    return out;
  });

  console.log(JSON.stringify(storeOut, null, 1));
  rec('group store methods present', Object.values(storeOut.methods).every(t => t === 'function'), JSON.stringify(storeOut.methods));
  rec('created group shape matches', !!storeOut.createdShape && storeOut.createdShape.name === 'Test Group' && storeOut.createdShape.kind === 'vp' && storeOut.createdShape.value === '2', JSON.stringify(storeOut.createdShape));
  rec('updated group persists', !!storeOut.updated && storeOut.updated.name === 'Renamed' && storeOut.updated.kind === 'objective' && storeOut.updated.value === '5');
  rec('add/remove hexes mutate membership', Array.isArray(storeOut.afterAdd) && Array.isArray(storeOut.afterRemove) && storeOut.afterAdd.includes(storeOut.codes[2]) && !storeOut.afterRemove.includes(storeOut.codes[0]));
  rec('exportProjectObject includes groups', Array.isArray(storeOut.exportedGroups) && storeOut.exportedGroups.length > 0 && storeOut.exportedHasShape);
  rec('delete group does not remove terrain', storeOut.groupGone && storeOut.landBefore === storeOut.landAfter, `land ${storeOut.landBefore} -> ${storeOut.landAfter}`);
  rec('undo restores deleted group', storeOut.undoRestored === true);
  rec('redo removes group again', storeOut.redoRemoved === true);
  rec('round-trip load preserves group', !!storeOut.roundTrip && storeOut.roundTrip.name === 'Round' && storeOut.roundTrip.hexes.length === 2);

  // UI checks: multi-select and group panel.
  await page.evaluate(() => { window.hexwright.ui.setMode('inspect'); });
  await sleep(200);

  const uiOut = await page.evaluate(async () => {
    const out = {};
    try {
      const hw = window.hexwright, ren = hw.renderer, store = hw.store, ui = hw.ui;
      const terr = store.state.terrain?.terrain || {};
      const codes = Object.keys(terr).slice(4, 6);
      out.codes = codes;

      // Programmatically set a multi-selection to drive the create button.
      ren.clearHexSelection();
      ren.selectedHexes.add(codes[0]);
      ren.selectedHexes.add(codes[1]);
      ren.selectedHex = codes[0];
      ren._notifySelectionChange();
      ren.draw();
      out.selectionSize = ren.selectedHexes.size;

      document.getElementById('group-create-name').value = 'UI Group';
      document.getElementById('group-create-kind').value = 'objective';
      document.getElementById('group-create-value').value = '3';
      document.getElementById('group-create-btn').click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      const groups = store.getGroups();
      out.uiGroup = groups.find(g => g.name === 'UI Group');
      out.rowCount = document.querySelectorAll('.group-row').length;

      // Click the row to select it and reveal the edit form.
      const row = document.querySelector(`.group-row[data-group-id="${out.uiGroup?.id}"]`);
      row?.click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      out.editVisible = !document.getElementById('group-edit-form').hidden;
      out.editName = document.getElementById('group-edit-name').value;

      // Update via edit form.
      document.getElementById('group-edit-name').value = 'Edited Group';
      document.getElementById('group-edit-save').click();
      await new Promise(r => setTimeout(r, 50));
      out.edited = store.getGroup(out.uiGroup?.id)?.name;

      // Two-step delete in UI: first click arms, second click deletes.
      // The row list re-renders on arm, so re-query the button each time —
      // holding the first node checks a detached element.
      const delSel = `.group-del[data-group-id="${out.uiGroup?.id}"]`;
      document.querySelector(delSel)?.click();
      await new Promise(r => setTimeout(r, 50));
      out.armedAfterFirst = document.querySelector(delSel)?.classList.contains('confirming');
      document.querySelector(delSel)?.click();
      await new Promise(r => setTimeout(r, 50));
      out.deletedViaUi = !store.getGroup(out.uiGroup?.id);
    } catch (e) {
      out.err = String(e);
    }
    return out;
  });

  console.log(JSON.stringify(uiOut, null, 1));
  rec('UI multi-selection size', uiOut.selectionSize === 2, String(uiOut.selectionSize));
  rec('UI create-from-selection adds group', !!uiOut.uiGroup && uiOut.uiGroup.hexes.length === 2, JSON.stringify(uiOut.uiGroup));
  rec('group rows rendered', uiOut.rowCount >= 1, String(uiOut.rowCount));
  rec('edit form visible on row click', uiOut.editVisible === true);
  rec('edit form loaded group name', uiOut.editName === 'UI Group');
  rec('edit save updates group name', uiOut.edited === 'Edited Group', String(uiOut.edited));
  rec('UI two-step delete arms then deletes', uiOut.armedAfterFirst === true && uiOut.deletedViaUi === true);
  rec('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (e) {
  console.log('FATAL', String(e));
  rec('run', false, String(e));
} finally {
  await browser.close();
  srv.kill();
  const fails = results.filter(x => !x.ok).length;
  console.log(`\n=== ${results.length - fails}/${results.length} passed ===`);
  process.exit(fails ? 1 : 0);
}
