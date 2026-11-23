import { test, expect } from './fixture.js';
test('connected boards immediately drive charts and ticket timelines without entering URLs', async ({
  page,
}) => {
  const site = 'sample',
    tickets = ['APP-24', 'APP-17'].map((key, i) => ({
      key,
      site,
      project: 'APP',
      title: i ? 'Checkout' : 'Sandbox',
      status: 'In progress',
      category: 'indeterminate',
      owner: 'Iman',
      updated: '2026-01-01T10:00:00Z',
    }));
  await page.route('**/api/board', async (route) => {
    const result = await route.fetch(),
      b = await result.json();
    const boards = [
      { id: 'https://example.atlassian.net#1', name: 'Quality', keys: ['APP-24'], project: 'APP' },
      {
        id: 'https://example.atlassian.net#2',
        name: 'Delivery',
        keys: ['APP-24', 'APP-17'],
        project: 'APP',
      },
    ];
    b.workspace = {
      sites: [{ id: site, url: 'https://example.atlassian.net', boards, tickets }],
      jiraConnected: true,
      checked: '2026-01-01',
      repos: ['acme/web'],
      pulls: [],
    };
    await route.fulfill({ response: result, json: b });
  });
  await page.goto('/sample/#projects');
  await expect(page.getByRole('heading', { name: 'Delivery status' })).toBeVisible();
  await expect(page.locator('.trace-row')).toHaveCount(2);
  await page.getByRole('button', { name: /Quality APP/ }).click();
  await expect(page.locator('.trace-row')).toHaveCount(1);
  await page.locator('.trace-row').click();
  await expect(page.getByRole('dialog')).toContainText('The test worker still fails');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Board workload' })).toBeVisible();
  await expect(page.locator('.stage-grid')).toContainText('In progress1');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
