import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/store.js';
import { submitChat, chatHistory, waitingChat, replyChat } from '../src/chat.js';
import { markers } from '../src/engine.js';
function desk(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'kancha-analysis-')),
    store = openStore({ directory });
  t.after(() => {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return store;
}
test('browser session mailbox persists one reply; CLI includes only visible work and same-engine history', async (t) => {
  const store = desk(t);
  const q = { id: randomUUID(), engine: 'session', question: 'Which review comes first?' };
  submitChat(store, q);
  submitChat(store, q);
  assert.equal(waitingChat(store).id, q.id);
  assert.throws(() => submitChat(store, { ...q, id: randomUUID() }));
  replyChat(store, q.id, 'Review A.');
  assert.throws(() => replyChat(store, q.id, 'Again'));
  assert.deepEqual(waitingChat(store), { waiting: false });
  store.put({ title: 'Hidden', project: 'X', why: 'Test', kind: 'task' }, 'host', 'hidden');
  store.tx(() => store.forget(store.get('hidden')));
  let snapshot;
  submitChat(store, { ...q, id: randomUUID(), engine: 'codex' }, async (_, context) => {
    snapshot = context;
    return 'No visible actions.';
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(snapshot.actions, []);
  assert.deepEqual(snapshot.previous, []);
  assert.equal(chatHistory(store).at(-1).answer, 'No visible actions.');
});
test('deadline alarms and 7-day flow reflect real actions, snooze and completion', (t) => {
  const store = desk(t),
    due = new Date(Date.now() - 1000).toISOString();
  const i = store.put({
    title: 'Review',
    project: 'X',
    why: 'Due',
    kind: 'review',
    priority: 'high',
    due,
  });
  let b = store.board();
  assert.deepEqual(
    b.items[0].factors.map(([k]) => k),
    ['High priority', 'Overdue', 'Review requested'],
  );
  assert.equal(markers(b)[0].label, 'Overdue');
  store.update(i.id, 'snooze', new Date(Date.now() + 3600000).toISOString());
  assert.deepEqual(markers(store.board()), []);
  store.update(i.id, 'done');
  b = store.board();
  assert.deepEqual(markers(b), []);
  assert.equal(b.flow.length, 7);
  assert.equal(b.flow.at(-1).completed, 1);
  assert.equal(b.flow.at(-1).added, 1);
});
