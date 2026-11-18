export const day = 86400000;
export function priorityFactors(item, at) {
  const values = [];
  if (item.stage === 'focus') values.push(['Accepted focus', 10000]);
  if (item.stage === 'ready') values.push(['Blocker resolved', 1000]);
  const priority = item.personalPriority || item.priority;
  if (priority === 'urgent')
    values.push([item.personalPriority ? 'Personal priority: urgent' : 'Urgent', 300]);
  if (priority === 'high')
    values.push([item.personalPriority ? 'Personal priority: high' : 'High priority', 100]);
  if (item.personalPriority === 'normal') values.push(['Personal priority: normal', 0]);
  const due = Date.parse(item.due);
  if (due < at + day) values.push([due <= at ? 'Overdue' : 'Due within 24 hours', 90]);
  if (item.kind === 'review') values.push(['Review requested', 20]);
  return values;
}

export function weeklyFlow(db, at) {
  const first = new Date(at);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - 6);
  const dates = Array.from({ length: 7 }, (_, n) => {
    const start = new Date(first);
    start.setDate(start.getDate() + n);
    return {
      start: start.toISOString(),
      label: start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      added: 0,
      completed: 0,
    };
  });
  const statement = db.prepare(
    "SELECT h.at,h.message FROM history h JOIN work w ON w.id=h.item WHERE h.at >= ? AND h.at <= ? AND json_extract(w.data,'$.visible')=1 AND h.message IN ('Added to your workspace','Marked personal action complete')",
  );
  for (const evt of statement.iterate(dates[0].start, new Date(at).toISOString())) {
    const bucket = dates.findLast((d) => d.start <= evt.at);
    bucket[evt.message === 'Added to your workspace' ? 'added' : 'completed']++;
  }
  return dates;
}
