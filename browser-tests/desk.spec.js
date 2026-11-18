import { test, expect } from './fixture.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

test('desk to source reply to a resumed coding session', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const failures = [];
  page.on('response', (r) => {
    if (r.status() >= 400) failures.push(r.status() + ' ' + r.url());
  });
  await page.goto('/sample/');
  await expect(page.getByRole('heading', { name: 'Confirm the legacy checkout rule' })).toBeVisible();
  if (process.env.KANCHA_SCREENSHOT) {
    mkdirSync(path.dirname(process.env.KANCHA_SCREENSHOT), { recursive: true });
    await page.screenshot({
      path: process.env.KANCHA_SCREENSHOT,
      fullPage: true,
      animations: 'disabled',
    });
  }
  await page.getByRole('button', { name: 'Open work brief' }).click();
  await page.getByRole('button', { name: 'Ask / watch' }).click();
  await page.getByLabel('Exact question').fill('May we omit tax ID?');
  await page.getByLabel('Who can answer?').fill('Iman');
  await page.getByRole('button', { name: 'Start local watch' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting on Iman' })).toBeVisible();
  await page.getByRole('button', { name: 'Review & post question' }).click();
  await page.getByRole('button', { name: 'Post question', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate owner reply' }).click();
  await page.getByRole('button', { name: 'Use this answer' }).click();
  await page.getByRole('button', { name: 'Resume work' }).click();
  await expect(page.getByRole('button', { name: 'Copy handoff' })).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await expect(page.locator('.hero .label')).toContainText('In focus');
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});
test('live work capture, checkpoint, evidence, search, snooze and workspace settings', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Capture work' }).click();
  await page.getByLabel('Next action').fill('Review API example');
  await page.getByLabel('Why does it matter?').fill('Unblocks QA');
  await page.getByRole('button', { name: 'Save action' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel('Where should your next session begin?').fill('fixture B');
  await page.getByRole('button', { name: 'Save checkpoint' }).click();
  await page.getByRole('button', { name: 'Attach', exact: true }).click();
  await page.getByLabel('Source or document').fill('Support thread');
  await page.getByLabel('Relevant passage or observation').fill('Customer reported the mismatch.');
  await page.getByRole('button', { name: 'Attach to brief' }).click();
  await expect(page.getByText('fixture B', { exact: true })).toBeVisible();
  await expect(page.getByText('Customer reported the mismatch.')).toBeVisible();
  await page.getByRole('button', { name: 'Remind me later' }).click();
  await page.getByRole('button', { name: 'Snooze action' }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Work queue', exact: true }).click();
  await page.getByRole('button', { name: 'Snoozed', exact: true }).click();
  await expect(page.locator('main').getByText('Review API example', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Search work', exact: true }).click();
  await page.getByRole('searchbox').fill('API example');
  await page.locator('#results button').click();
  await page.getByRole('button', { name: 'Unsnooze' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Complete', exact: true }).click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByLabel('Your name').fill('Pilot User');
  await page.getByRole('button', { name: 'Save workspace' }).click();
  await expect(page.getByRole('status')).toHaveText('Workspace saved.');
  await page.reload();
  await expect(page.getByLabel('Your name')).toHaveValue('Pilot User');
});
test('small screen keeps the desk and brief within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/sample/');
  await page.getByRole('button', { name: 'Open work brief' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
