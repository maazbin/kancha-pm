function decode(s) {
  return s.replace(/&(amp|quot|apos|lt|gt|nbsp|#39|#\d+|#x[\da-f]+);/gi, (whole, key) => {
    if (key.startsWith('#')) {
      const cp = key[1] === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[key.toLowerCase()];
  });
}
export function commentBody(body) {
  const mentions = new Map();
  let text = '';
  if (typeof body === 'string') {
    const plain = (s) =>
      decode(s.replace(/<\/?(?:p|li|br)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, ''))
        .replace(/\s+/g, ' ')
        .trim();
    for (const m of body.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/gi)) {
      const attrs = Object.fromEntries(
        [...m[1].matchAll(/(?:^|\s)([\w-]+)\s*=\s*(["'])(.*?)\2/g)].map((a) => [a[1], decode(a[3])]),
      );
      if (attrs['data-type'] === 'mention' && attrs['data-user-id'])
        mentions.set(attrs['data-user-id'], plain(m[2]) || 'Mentioned account');
    }
    text = plain(body);
  } else {
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'mention' && node.attrs?.id) {
        const label = node.attrs.text || 'Mentioned account';
        mentions.set(node.attrs.id, label);
        text += label;
      } else if (node.type === 'text') text += node.text || '';
      for (const child of node.content || []) visit(child);
      if (['paragraph', 'hardBreak', 'listItem'].includes(node.type)) text += ' ';
    }
    visit(body);
  }
  return { text: text.trim(), mentions: [...mentions].map(([id, label]) => ({ id, label })) };
}
export function commentEvent(c, url) {
  const body = commentBody(c.body);
  return {
    id: 'comment:' + c.id,
    kind: 'comment',
    at: c.created,
    actor: c.author?.displayName || '',
    title: 'Commented',
    body: body.text,
    mentions: body.mentions,
    edited: c.updated && Date.parse(c.updated) !== Date.parse(c.created) ? c.updated : null,
    url: url + '?focusedCommentId=' + encodeURIComponent(c.id),
  };
}
export const historyFields = ['created', 'creator', 'summary', 'status', 'assignee', 'description'];
export async function ticketHistory(read, site, key) {
  const args = { cloudId: site.id, issueIdOrKey: key },
    url = site.url + '/browse/' + key;
  const raw = await read('getJiraIssue', {
    ...args,
    fields: historyFields,
    responseContentFormat: 'html',
    view: 'full',
  });
  const f = raw.fields || {};
  const events = [],
    notices = [];
  if (f.created)
    events.push({
      id: 'created',
      kind: 'created',
      at: f.created,
      actor: f.creator?.displayName || '',
      title: 'Created the ticket',
      url,
    });
  const collect = async (label, fetchPage, field, convert) => {
    try {
      let offset = 0;
      for (let page = 0; page < 10; page++) {
        const data = await fetchPage(offset),
          rows = data[field];
        if (!Array.isArray(rows)) throw Error();
        for (const row of rows) events.push(...convert(row));
        offset += rows.length;
        if (data.isLast === true || offset >= data.total || !rows.length) return;
        if (page === 9) notices.push('More ' + label + ' are available in Jira.');
      }
    } catch {
      notices.push('Some ' + label + ' could not be loaded.');
    }
  };
  await Promise.all([
    collect(
      'comments',
      (startAt) =>
        read('listJiraIssueComments', {
          ...args,
          startAt,
          maxResults: 20,
          orderBy: '-created',
          view: 'full',
          responseContentFormat: 'html',
        }),
      'comments',
      (c) => [commentEvent(c, url)],
    ),
    collect(
      'field changes',
      (startAt) =>
        read('executeRead', {
          name: 'listJiraIssueChangelogs',
          cloudId: site.id,
          inputs: { issueIdOrKey: key, startAt, maxResults: 50 },
          view: 'evidence',
        }),
      'values',
      (entry) =>
        (entry.items || []).map((i, index) => ({
          id: 'change:' + entry.id + ':' + index,
          kind: 'change',
          at: entry.created,
          actor: entry.author?.displayName || '',
          title: 'Changed ' + i.field,
          body: ['status', 'assignee', 'priority', 'duedate', 'summary', 'resolution'].includes(
            String(i.field).toLowerCase(),
          )
            ? (i.fromString || 'Unset') +
              ' → ' +
              (i.toString && typeof i.toString === 'string' ? i.toString : 'Unset')
            : 'See the change in Jira.',
          url,
        })),
    ),
  ]);
  return {
    key,
    summary: f.summary,
    owner: f.assignee?.displayName || '',
    status: f.status?.name || '',
    description: commentBody(f.description),
    url,
    events: [...new Map(events.map((e) => [e.id, e])).values()].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
    ),
    notices,
  };
}
export function sampleHistory(row) {
  const events = [
    {
      id: 'created',
      kind: 'created',
      at: row.created || '2026-01-01T09:00:00Z',
      actor: row.creator || (row.key === 'APP-24' ? 'Iman' : ''),
      title: 'Created the ticket',
    },
  ];
  if (row.key === 'APP-24')
    events.push(
      {
        id: 'change:1',
        kind: 'change',
        at: '2026-01-01T09:10:00Z',
        actor: 'Iman',
        title: 'Changed status',
        body: 'To do → In progress',
      },
      {
        id: 'comment:7',
        kind: 'comment',
        at: '2026-01-01T09:24:00Z',
        actor: 'Iman',
        title: 'Commented',
        body: '@Maz the sandbox API is responding. The test worker still fails its startup check. Can you check the worker?',
        mentions: [{ id: 'maz', label: '@Maz' }],
      },
    );
  return {
    key: row.key,
    summary: row.summary,
    status: row.status,
    owner: row.owner,
    events: [...events, ...(row.events || [])],
    notices: [],
    url: null,
  };
}
