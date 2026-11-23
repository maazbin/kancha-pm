import test from 'node:test';
import assert from 'node:assert/strict';
import { scanComments } from '../src/handoffs.js';
import { commentBody, ticketHistory } from '../src/ticket-history.js';
test('a returning developer catches up across issue and comment pages without advancing past incomplete reads', async () => {
  const started = Date.parse('2026-11-10T10:00:00Z'),
    cursor = started - 7 * 86400000;
  const mention = {
    id: 'c',
    created: '2026-11-06',
    body: { type: 'mention', attrs: { id: 'me', text: '@Maz' } },
  };
  const read = async (name, a) => {
    if (name === 'executeRead') return { accountId: 'me' };
    if (name === 'searchJiraIssuesUsingJql') {
      assert.match(a.jql, /-10085m/);
      return a.nextPageToken
        ? { issues: [{ key: 'QA-2' }], isLast: true }
        : { issues: [{ key: 'QA-1' }], isLast: false, nextPageToken: 'next' };
    }
    if (a.issueIdOrKey === 'QA-1') return { comments: [], total: 0 };
    return a.startAt
      ? { comments: [mention], total: 2 }
      : { comments: [{ id: 'other', body: 'Maz', created: '2026-11-07' }], total: 2 };
  };
  const result = await scanComments(read, 's', 'QA', { cursor, account: 'me' }, started);
  assert.deepEqual(
    result.alerts.map((x) => x.id),
    ['QA-2:c'],
  );
  assert.equal(result.cursor, started);
  const partial = await scanComments(
    (n, a) => {
      if (a.issueIdOrKey === 'QA-1') throw Error();
      return read(n, a);
    },
    's',
    'QA',
    { cursor, account: 'me' },
    started,
  );
  assert.equal(partial.partial, true);
  assert.equal(partial.cursor, cursor);
});

const markup =
  '<p><span data-type="mention" data-user-id="acct-maz">@Maz</span> the API is ready &amp; the worker is down.</p>';
test('personal reminders require an explicit account mention and distinguish a current description from a comment', async () => {
  const stamp = new Date().toISOString();
  const read = async (name, a) => {
    if (name === 'executeRead') return { accountId: 'acct-maz' };
    if (name === 'searchJiraIssuesUsingJql')
      return {
        issues: [{ key: 'QA-1', fields: { created: stamp, description: markup } }, { key: 'QA-2' }],
        isLast: true,
      };
    if (a.issueIdOrKey === 'QA-2') throw Error('restricted');
    return {
      comments: [
        { id: '10', created: stamp, body: markup },
        { id: '11', created: stamp, body: 'Maz, ask @Maz' },
        { id: '12', created: stamp, body: markup.replace('acct-maz', 'acct-other') },
        { id: '13', created: '2020-01-01', body: markup },
      ],
      total: 4,
    };
  };
  const result = await scanComments(read, 's', 'QA');
  assert.deepEqual(
    result.alerts.map((a) => a.id),
    ['QA-1:description', 'QA-1:10'],
  );
  assert.equal(result.partial, true);
  assert.equal(result.recent[0].key, 'QA-1');
  assert.equal(commentBody(markup).text, '@Maz the API is ready & the worker is down.');
  assert.deepEqual(
    commentBody({ type: 'doc', content: [{ type: 'mention', attrs: { id: 'acct-maz', text: '@Maz' } }] })
      .mentions,
    [{ id: 'acct-maz', label: '@Maz' }],
  );
});
test('timeline pages, chronologically merges original authors and labels unavailable history', async () => {
  const site = { id: 's', url: 'https://example.atlassian.net' };
  const read = async (name, a) => {
    if (name === 'getJiraIssue')
      return { fields: { summary: 'Sandbox', created: '2026-01-01', creator: { displayName: 'Iman' } } };
    if (name === 'executeRead')
      return {
        values: [
          {
            id: 'x',
            created: '2026-01-02',
            author: { displayName: 'Iman' },
            items: [{ field: 'status', fromString: 'Open', toString: 'In progress' }],
          },
        ],
        isLast: true,
      };
    return {
      comments: a.startAt
        ? [{ id: '6', created: '2026-01-03', body: 'Checking the worker' }]
        : [{ id: '7', created: '2026-01-04', body: markup, author: { displayName: 'Iman' } }],
      total: 2,
    };
  };
  const h = await ticketHistory(read, site, 'QA-1');
  assert.deepEqual(
    h.events.map((e) => e.id),
    ['created', 'change:x:0', 'comment:6', 'comment:7'],
  );
  assert.equal(h.events[2].actor, '');
  assert.equal(h.events[3].url, site.url + '/browse/QA-1?focusedCommentId=7');
  assert.equal(h.events[3].mentions[0].id, 'acct-maz');
  assert.equal(h.events[1].body, 'Open → In progress');
  const partial = await ticketHistory(
    (n, a) => {
      if (n === 'executeRead') throw Error();
      return read(n, a);
    },
    site,
    'QA-1',
  );
  assert.deepEqual(partial.notices, ['Some field changes could not be loaded.']);
});
