import { test, expect } from '@playwright/test';

for (const [width, height] of [[1280, 720], [500, 500], [320, 568], [390, 844], [844, 390]]) {
  test(`playfield and controls fit ${width}x${height}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
    for (const selector of ['canvas', '.scoreboard', '.game-footer', '.start-buttons']) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    await testInfo.attach('start-screen', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Start Game', exact: true }).click();
    await expect(page.getByText('Press Space or tap to serve')).toBeVisible();
    const canvas = page.locator('canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.7);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
    await page.mouse.up();
    await expect(page.getByText('Press Space or tap to serve')).not.toBeVisible();
    await testInfo.attach('playing-screen', { body: await page.screenshot(), contentType: 'image/png' });
    expect(errors).toEqual([]);
  });
}

test('keyboard controls, pause and AI exit work without scrolling', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'AI Mode', exact: true }).click();
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Press Space or tap to serve')).not.toBeVisible();
  await page.keyboard.press('p');
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  const image = await page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(100);
  expect(await page.locator('canvas').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL())).toBe(image);
  await page.getByRole('button', { name: 'Resume game', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: 'Paused' })).not.toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.getByRole('heading', { name: 'Paused' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to menu' }).click();
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paused' })).not.toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(0);
});

test('touch drag moves the player paddle and serves', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Start Game', exact: true }).click();
  const box = (await page.locator('canvas').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await expect(page.getByText('Press Space or tap to serve')).not.toBeVisible();
  // The cyan paddle should have moved into the top half in canvas coordinates.
  await expect.poll(() => page.locator('canvas').evaluate(element => {
    const data = (element as HTMLCanvasElement).getContext('2d')!.getImageData(4, 90, 1, 1).data;
    return data[1] > 150 && data[2] > 150;
  })).toBe(true);
  await context.close();
});
