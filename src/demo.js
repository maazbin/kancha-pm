import { now } from './store.js';
import { followBoard, observeBoard } from './projects.js';
function seedProjects(s) {
  if (s.config('sampleProjects', false)) return;
  const site = 'https://example.atlassian.net',
    boards = [
      ['Mobile delivery', 12, ['MOB-42', 'BILL-26']],
      ['Billing release', 37, ['BILL-26']],
    ];
  s.tx(() => {
    // Only sample data is edited. Keep the user's sample workflow state intact.
    for (const [id, key] of [
      ['checkout', 'MOB-42'],
      ['sync', 'BILL-26'],
    ]) {
      const i = s.get(id);
      s.save({ ...i, url: site + '/browse/' + key });
    }
    const pr = s.get('receipt');
    s.save({
      ...pr,
      url: 'https://github.com/example/checkout/pull/193',
      linkedIssues: [site + '/browse/BILL-26'],
    });
  });
  for (const [name, id, keys] of boards) {
    const url = site + '/jira/software/c/projects/MCQ/boards/' + id;
    followBoard(s, { name, url, repos: ['example/checkout'] });
    observeBoard(s, {
      boardUrl: url,
      issues: keys.map((key) => site + '/browse/' + key),
      complete: true,
    });
  }
  s.set('sampleProjects', true);
}
export function seedDemo(s) {
  if (!s.demo) return;
  if (s.config('seeded', false)) {
    seedProjects(s);
    return;
  }
  const lock = s.acquire('seed');
  if (!lock) return;
  try {
    if (s.config('seeded', false)) return;
    s.configure({ ...s.settings(), name: 'Maz' });
    const samples = [
      [
        'checkout',
        'Confirm the legacy checkout rule',
        'Checkout',
        'decision',
        'high',
        'Mobile QA is waiting on the rule for existing accounts. One answer from Product unlocks the verification run.',
        'MOB-42',
        'Product contract §4',
        'New accounts require a tax ID. The contract does not specify how to handle accounts created before migration.',
      ],
      [
        'receipt',
        'Review the receipt copy change',
        'Billing',
        'review',
        'normal',
        'Nadia requested your review before support publishes the receipt guidance.',
        '#193',
        'Review request',
        'Check the refund window in the updated receipt copy against the approved support wording.',
      ],
      [
        'search',
        'Verify search indexing after import',
        'Search',
        'task',
        'normal',
        'You own the verification step for the next catalog import.',
        'SRCH-18',
        'Acceptance criterion',
        'A newly imported product should be discoverable by SKU after the indexing job finishes.',
      ],
      [
        'api',
        'Get sign-off on the export contract',
        'Platform',
        'decision',
        'normal',
        'The export team needs confirmation of the pagination field.',
        'API-71',
        'Contract review',
        'Product and Integrations must agree on a stable field name.',
      ],
      [
        'sync',
        'Check the billing retry report',
        'Billing',
        'incident',
        'normal',
        'Support linked a retry alert to a customer report. Confirm the relationship before assigning cause.',
        'BILL-26',
        'Reported alert',
        'Support reported two receipts for one invoice. The attached alert recorded retries in the same period.',
      ],
    ];
    for (const [id, title, project, kind, priority, why, sourceKey, label, detail] of samples)
      s.put({ title, project, kind, priority, why, evidence: [{ label, detail }] }, 'demo', id, {
        sourceKey,
      });
    s.update(
      'checkout',
      'checkpoint',
      'Resume at mobile/tests/checkout/legacy-account.test.ts. The missing-tax-ID fixture is ready.',
    );
    s.watch('api', {
      question: 'Should the export cursor be named nextCursor?',
      owner: 'Iman',
      checkAt: new Date(Date.now() + 86400000).toISOString(),
    });
    s.watch('sync', {
      question: 'Which invoice ID should we compare with the retry report?',
      owner: 'Nadia',
      checkAt: new Date(Date.now() + 3600000).toISOString(),
    });
    s.edit('sync', (i) => {
      i.watch.status = 'reply';
      i.watch.candidate = {
        display: 'Nadia',
        body: 'Use the sample invoice INV-204 in the support report. The customer saw two receipts.',
        when: now(),
      };
      s.history(i.id, 'Nadia replied to the invoice question');
    });
    s.set('seeded', true);
    seedProjects(s);
  } finally {
    s.release('seed', lock);
  }
}
