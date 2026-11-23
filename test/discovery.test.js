import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSite } from '../src/discovery.js';
test('one Jira account discovers overlapping boards, private assignments, and verified membership across pages', async () => {
  const row = (k) => ({
    key: k,
    fields: {
      summary: k,
      project: { key: 'QA' },
      status: { name: 'Doing', statusCategory: { key: 'indeterminate' } },
    },
  });
  const read = async (n, a) => {
    if (n === 'searchJiraIssuesUsingJql') return { issues: [row('QA-9')], isLast: true };
    const p = a.inputs;
    if (a.name === 'listJiraBoards')
      return { values: [{ id: p.startAt ? 2 : 1, name: 'Board ' + p.startAt }], total: 2 };
    if (a.name === 'listJiraProjects') return { values: [{ key: 'QA', name: 'Testing' }], total: 1 };
    if (a.name === 'getJiraCurrentUser') return { accountId: 'dev' };
    if (a.name === 'getJiraBoardIssueData')
      return p.boardId === 2
        ? { issues: [row('QA-1')], isLast: true }
        : p.nextPageToken
          ? { issues: [row('QA-2')], isLast: true }
          : { issues: [row('QA-1')], nextPageToken: 'next' };
    throw Error();
  };
  const x = await discoverSite(read, { id: 's', url: 'https://example.atlassian.net' });
  assert.equal(x.partial, false);
  assert.deepEqual(
    x.boards.map((b) => b.keys),
    [['QA-1', 'QA-2'], ['QA-1']],
  );
  assert.deepEqual(
    x.tickets.map((t) => [t.key, t.mine]),
    [
      ['QA-1', false],
      ['QA-2', false],
      ['QA-9', true],
    ],
  );
});
