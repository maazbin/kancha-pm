import test from 'node:test';
import assert from 'node:assert/strict';
import { flowData, signals } from '../web/delivery.js';
test('delivery periods use recorded resolution dates, exclude reopened tickets and compare the preceding window', () => {
  const at = Number(new Date(2026, 10, 23, 12));
  const row = (key, created, resolved, category = 'done') => ({
    key,
    created: new Date(2026, 10, created, 9).toISOString(),
    resolved: resolved ? new Date(2026, 10, resolved, 9).toISOString() : null,
    category,
  });
  const rows = [
    row('a', 16, 17),
    row('b', 19, 23),
    row('c', 10, 15),
    row('d', 20, 22, 'new'),
    row('e', 21, null),
  ];
  const f = flowData(rows, at, 7);
  assert.deepEqual(
    f.closed.map((x) => x.key),
    ['a', 'b'],
  );
  assert.equal(f.priorClosed, 1);
  assert.equal(f.opened.length, 3);
  assert.equal(f.median, 2.5);
  assert.equal(f.p85, 4);
  assert.equal(f.missing, 1);
  assert.deepEqual(
    signals(
      { category: 'indeterminate', status: 'In review', updated: '2026-10-01', due: '2026-11-22' },
      at,
    ),
    ['overdue', 'unassigned', 'review', 'quiet'],
  );
  assert.deepEqual(signals({ ...rows[0], status: 'Blocked' }, at), []);
});
