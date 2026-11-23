import { workspaceSnapshot } from './workspace-state.js';
import { boardScope, flowData, signals, open } from '../web/delivery-data.js';
export function deliveryHealth(store, { boardId = '', days = 30 } = {}) {
  const workspace = workspaceSnapshot(store);
  if (!workspace.sites.length)
    return {
      available: false,
      reason: workspace.jiraConnected
        ? 'Waiting for a usable Jira snapshot.'
        : 'Connect Jira to read shared delivery metrics.',
    };
  const { scope, rows } = boardScope(workspace, boardId);
  if (boardId && !scope)
    throw Error('That board is outside the current Jira snapshot. Use a board ID from project_scope.');
  const at = Date.now(),
    flow = flowData(rows, at, days),
    risks = { blocked: 0, overdue: 0, review: 0, unassigned: 0, quiet: 0 };
  const active = rows.filter(open),
    candidates = [];
  for (const t of active) {
    const reasons = signals(t, at);
    for (const reason of reasons) risks[reason]++;
    if (reasons.length) candidates.push({ t, reasons });
  }
  const examples = candidates
    .sort(
      (a, b) =>
        Number(b.t.mine) - Number(a.t.mine) ||
        Number(b.reasons.includes('blocked')) - Number(a.reasons.includes('blocked')) ||
        Number(b.reasons.includes('overdue')) - Number(a.reasons.includes('overdue')) ||
        String(a.t.updated || '').localeCompare(String(b.t.updated || '')),
    )
    .slice(0, 3);
  return {
    available: true,
    board: scope?.name || 'All boards',
    days,
    checked: workspace.checked,
    partial:
      !!workspace.jiraError || workspace.sites.some((s) => (!scope || s.id === scope.site) && s.partial),
    open: active.length,
    opened: flow.opened.length,
    resolved: flow.closed.length,
    previous: { opened: flow.priorOpened, resolved: flow.priorClosed },
    turnaroundDays: { median: flow.median, p85: flow.p85, measured: flow.measured },
    doneWithoutResolutionDate: flow.missing,
    risks,
    examples: examples.map(({ t, reasons }) => ({
      key: t.key,
      title: t.title,
      owner: t.owner || null,
      status: t.status,
      updated: t.updated,
      due: t.due,
      reasons,
      url: new URL('/browse/' + t.key, workspace.sites.find((s) => s.id === t.site).url).href,
    })),
    definition:
      'Current board membership. Open risks can overlap. Quiet means no recorded Jira update for 14 days. Turnaround is creation to the current resolution.',
  };
}
