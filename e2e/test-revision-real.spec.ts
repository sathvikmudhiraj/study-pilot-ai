import { test, expect } from '@playwright/test';

test('real revision test', async ({ page }) => {
  test.setTimeout(180000);
  
  // Login
  await page.goto('/auth?mode=login');
  await page.getByLabel('Email').fill('ssadaboi@gitam.in');
  await page.getByLabel('Password').fill('SATH0530');
  await page.locator('form').getByRole('button', { name: /^log in$/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  
  // Go to revision page
  await page.goto('/revision');
  await expect(page.getByRole('heading', { name: /revision planner/i })).toBeVisible();
  
  // Click generate plan - don't stub the API
  const generatePlan = page.getByRole('button', { name: /generate plan|regenerate plan/i }).first();
  await generatePlan.click();
  
  // Wait for the plan to appear or error
  await page.waitForTimeout(120000);
  
  // Check what happened
  const content = await page.content();
  console.log('Page content length:', content.length);
  console.log('Contains timeout:', content.includes('timed out'));
  console.log('Contains error:', content.includes('error'));
  console.log('Contains plan:', content.includes('daily_plan') || content.includes('Revision Plan'));
});