// Anchored pitch math: changing col/row pitch must keep the anchor hex center
// fixed, lock half-pitch parity offsets, and scale free offsets proportionally.
import {
  applyAnchoredPitch, hexCenter, gridPitchReadout
} from '../src/geometry.js';

const results = [];
const rec = (name, ok, note = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${note}` : ''}`);
};

const baseGrid = {
  grid_version: 1,
  image_full: [1330, 1180],
  n_cols: 12,
  n_rows: 9,
  x_intercept_col0: 100,
  col_pitch_x: 100,
  y_intercept_row0: 100,
  row_pitch_y: 115,
  even_col_y_offset: 57.5
};

function almostEqual(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

{
  const anchorCol = 5;
  const anchorRow = 4;
  const code = '0504';
  const before = hexCenter(code, baseGrid);
  const next = applyAnchoredPitch(baseGrid, {
    colPitchDelta: 0.5,
    rowPitchDelta: 0,
    anchorCol,
    anchorRow
  });
  const after = hexCenter(code, next);
  rec(
    'col pitch change keeps anchor hex center invariant',
    next
      && almostEqual(after.x, before.x)
      && almostEqual(after.y, before.y)
      && almostEqual(next.col_pitch_x, 100.5)
      && almostEqual(next.x_intercept_col0, before.x - anchorCol * 100.5),
    JSON.stringify({ before, after, intercept: next?.x_intercept_col0, pitch: next?.col_pitch_x })
  );
}

{
  const anchorCol = 6; // even → uses even_col_y_offset
  const anchorRow = 3;
  const code = '0603';
  const before = hexCenter(code, baseGrid);
  const next = applyAnchoredPitch(baseGrid, {
    colPitchDelta: 0,
    rowPitchDelta: -0.05,
    anchorCol,
    anchorRow
  });
  const after = hexCenter(code, next);
  const halfLocked = almostEqual(next.even_col_y_offset, next.row_pitch_y / 2);
  rec(
    'row pitch change keeps anchor fixed and locks half-pitch offset',
    next
      && almostEqual(after.x, before.x)
      && almostEqual(after.y, before.y)
      && almostEqual(next.row_pitch_y, 114.95)
      && halfLocked,
    JSON.stringify({
      before,
      after,
      row_pitch_y: next?.row_pitch_y,
      even_col_y_offset: next?.even_col_y_offset,
      y_intercept_row0: next?.y_intercept_row0
    })
  );
}

{
  const free = {
    ...baseGrid,
    even_col_y_offset: 40 // not within 5% of 57.5
  };
  const next = applyAnchoredPitch(free, {
    colPitchDelta: 0,
    rowPitchDelta: 11.5, // 10% scale → 115 → 126.5
    anchorCol: 2,
    anchorRow: 1
  });
  const expectedOffset = 40 * (126.5 / 115);
  const before = hexCenter('0201', free);
  const after = hexCenter('0201', next);
  rec(
    'non-half parity offset scales proportionally; anchor stays fixed',
    next
      && almostEqual(next.even_col_y_offset, expectedOffset)
      && almostEqual(after.x, before.x)
      && almostEqual(after.y, before.y),
    JSON.stringify({
      offset: next?.even_col_y_offset,
      expectedOffset,
      before,
      after
    })
  );
}

{
  const nested = {
    grid_version: 1,
    image_full: [800, 600],
    x_model: { x_intercept_col0: 50, col_pitch_x: 80 },
    y_model: { y_intercept_row0: 60, row_pitch_y: 90, even_col_down_offset: 45 },
    even_col_y_offset: 45
  };
  const before = hexCenter('0302', nested);
  const next = applyAnchoredPitch(nested, {
    colPitchDelta: 0.05,
    rowPitchDelta: 0.05,
    anchorCol: 3,
    anchorRow: 2
  });
  const after = hexCenter('0302', next);
  const readout = gridPitchReadout(next);
  rec(
    'nested x_model/y_model pitch fields update and keep anchor',
    next
      && almostEqual(after.x, before.x)
      && almostEqual(after.y, before.y)
      && almostEqual(next.x_model.col_pitch_x, 80.05)
      && almostEqual(next.y_model.row_pitch_y, 90.05)
      && readout
      && almostEqual(readout.col_pitch_x, 80.05),
    JSON.stringify({ before, after, readout })
  );
}

{
  const v2 = {
    grid_version: 2,
    image_full: [1000, 800],
    n_cols: 6,
    row_counts_by_parity: { even: 4, odd: 5 },
    x_intercept_col0: 40,
    col_pitch_x: 70,
    y_intercept_row0: 30,
    row_pitch_y: 80,
    odd_col_y_offset: 40
  };
  const before = hexCenter('0102', v2); // odd col uses odd_col_y_offset
  const next = applyAnchoredPitch(v2, {
    colPitchDelta: 0,
    rowPitchDelta: 0.5,
    anchorCol: 1,
    anchorRow: 2
  });
  const after = hexCenter('0102', next);
  rec(
    'v2 odd_col_y_offset half-lock + anchor invariance',
    next
      && almostEqual(after.x, before.x)
      && almostEqual(after.y, before.y)
      && almostEqual(next.odd_col_y_offset, next.row_pitch_y / 2),
    JSON.stringify({ before, after, odd: next?.odd_col_y_offset, pitch: next?.row_pitch_y })
  );
}

const failed = results.filter((ok) => !ok).length;
console.log(`\n=== ${results.length - failed}/${results.length} checks passed ===`);
process.exit(failed ? 1 : 0);
