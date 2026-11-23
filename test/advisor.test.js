import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../src/store.js';
import { adviceContext, advisorState, saveAdvice, actOnAdvice, runAdvisor } from '../src/advisor.js';

test('a changed handoff calls the chosen coding engine, validates evidence and saves one private next move', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kancha-brain-')),
    store = openStore({ directory: dir });
  t.after(() => {
    store.db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  store.put(
    { title: 'Sandbox environment', project: 'QA', kind: 'task', why: 'Check the last handoff.' },
    'local',
    'qa',
  );
  store.set('advisor.engine', 'codex');
  let replies = 0;
  const answer = async (engine, packet) => {
    replies++;
    assert.equal(engine, 'codex');
    return JSON.stringify({
      next: 'Ask which worker check failed.',
      why: 'The sandbox handoff needs a reproducible check.',
      sources: [packet.sources[0].id],
    });
  };
  await runAdvisor(store, answer);
  await runAdvisor(store, answer);
  const brief = advisorState(store).brief;
  assert.equal(replies, 1);
  assert.ok(brief);
  assert.throws(() => saveAdvice(store, { ...brief, sources: ['invented'] }, 'session'), /Cite sources/);
  actOnAdvice(store, brief.revision, 'accept');
  assert.equal(store.board().items.filter((i) => i.stage === 'focus').length, 1);
  assert.ok(advisorState(store).accepted);
  assert.throws(
    () => saveAdvice(store, { revision: 'outdated', next: 'x', why: 'y', sources: ['qa'] }, 'session'),
    /evidence changed/,
  );
  assert.ok(adviceContext(store, 'sandbox').sources.some((s) => s.id === 'qa'));
});
