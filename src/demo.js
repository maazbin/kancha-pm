import { now } from './store.js';
export function seedDemo(s) {
  if (!s.demo || s.config('seeded', false)) return;
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
  } finally {
    s.release('seed', lock);
  }
}
