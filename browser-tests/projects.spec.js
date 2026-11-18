import { test, expect } from './fixture.js';
test('two board views share the same PR and Signals counts unique work', async ({ page }) => {
  await page.goto('/sample/#projects');
  await expect(page.getByRole('heading', { name: 'Mobile delivery' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Billing release' })).toBeVisible();
  const reviews = page.getByRole('button', { name: /Review the receipt copy change/ });
  await expect(reviews).toHaveCount(2);
  await reviews.first().click();
  await expect(page.getByText('Project links', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Signals', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Open work by board' })).toBeVisible();
  await expect(page.getByText('5 unique')).toBeVisible();
  await expect(page.getByRole('meter', { name: /Mobile delivery/ })).toHaveAttribute('value', '3');
});
test('a developer adds independent scopes from the dashboard', async ({ page }) => {
  await page.goto('/#projects');
  await page.getByRole('button', { name: 'Follow a board' }).click();
  await page.getByLabel('Board name').fill('QA');
  await page
    .getByLabel('Jira board URL')
    .fill('https://example.atlassian.net/secure/RapidBoard.jspa?rapidView=99');
  await page.getByRole('button', { name: 'Follow board', exact: true }).click();
  await page.getByRole('button', { name: 'Follow repository' }).click();
  await page.getByLabel('Owner/repository').fill('acme/mobile');
  await page.getByRole('dialog').getByRole('button', { name: 'Follow repository' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'QA', exact: true })).toBeVisible();
  await expect(page.getByText('acme/mobile', { exact: true })).toBeVisible();
});
