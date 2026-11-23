const DAY = 86400000;
const dateKey = (d) =>
  [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
function shift(d, days) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}
export const fmt = (d) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const stamp = (v) => Date.parse(v);
export const age = (at, v) => Math.max(0, Math.floor((at - stamp(v)) / DAY));
export const open = (t) => t.category !== 'done';
export const ownerId = (t) => JSON.stringify([t.site, t.account || t.owner]);
export function signals(t, at) {
  if (!open(t)) return [];
  const tags = [];
  if (/\b(blocked|on hold|paused|impeded)\b/i.test(t.status)) tags.push('blocked');
  if (t.due && t.due < dateKey(new Date(at))) tags.push('overdue');
  if (!t.owner) tags.push('unassigned');
  if (/\breview\b/i.test(t.status)) tags.push('review');
  if (age(at, t.updated) >= 14) tags.push('quiet');
  return tags;
}
export const labels = {
  all: 'All open',
  mentioned: 'Mentioned me',
  mine: 'Assigned to me',
  blocked: 'Blocked or paused',
  overdue: 'Past due',
  unassigned: 'Needs an owner',
  review: 'In review',
  quiet: 'No update in 14 days',
  done: 'Completed',
};
export function flowData(rows, at, days) {
  const end = shift(new Date(at), 1);
  end.setHours(0, 0, 0, 0);
  const start = shift(end, -days),
    previous = shift(start, -days);
  const count = Math.min(7, days),
    buckets = [];
  const during = (v, a, b) => stamp(v) >= +a && stamp(v) < +b && stamp(v) <= at;
  const resolved = (t) => t.category === 'done' && t.resolved;
  for (let i = 0; i < count; i++) {
    const a = shift(start, Math.floor((days * i) / count)),
      b = shift(start, Math.floor((days * (i + 1)) / count));
    buckets.push({
      label: fmt(a) + (days > 7 ? '–' + fmt(shift(b, -1)) : ''),
      opened: rows.filter((t) => during(t.created, a, b)),
      resolved: rows.filter((t) => during(resolved(t), a, b)),
    });
  }
  const opened = buckets.flatMap((b) => b.opened),
    closed = buckets.flatMap((b) => b.resolved);
  const times = closed
    .map((t) => (stamp(t.resolved) - stamp(t.created)) / DAY)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const quantile = (p) => (times.length ? times[Math.ceil(times.length * p) - 1] : null);
  return {
    buckets,
    opened,
    closed,
    priorOpened: rows.filter((t) => during(t.created, previous, start)).length,
    priorClosed: rows.filter((t) => during(resolved(t), previous, start)).length,
    median: times.length
      ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2
      : null,
    p85: quantile(0.85),
    measured: times.length,
    missing: rows.filter((t) => !open(t) && !Number.isFinite(stamp(t.resolved))).length,
  };
}
export function boardScope(workspace, boardId) {
  const boards = workspace.sites.flatMap((s) => s.boards.map((b) => ({ ...b, site: s.id }))),
    scope = boards.find((b) => b.id === boardId);
  const keys = new Set(scope?.keys),
    rows = workspace.sites
      .flatMap((s) => s.tickets)
      .filter((t) => !scope || (t.site === scope.site && keys.has(t.key)));
  return { boards, scope, rows };
}
