import { expect, test } from "@playwright/test";

test("searching by product name shows a sorted results list with a highlighted best price", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("tab-name").click();
  await page.getByTestId("name-input").fill("wireless headphones");
  await page.getByTestId("submit-name").click();

  const bestPriceCard = page.getByTestId("best-price-card");
  await expect(bestPriceCard).toBeVisible({ timeout: 15000 });
  await expect(bestPriceCard).toContainText("Best price");
  await expect(bestPriceCard).toContainText("$");

  await expect(page.getByTestId("demo-mode-banner")).toBeVisible();

  const offerRows = page.getByTestId("offer-row");
  await expect(offerRows.first()).toBeVisible();
  const rowCount = await offerRows.count();
  expect(rowCount).toBeGreaterThan(0);

  const bestPriceText = await bestPriceCard.locator("text=/\\$[0-9]+\\.[0-9]{2}/").first().textContent();
  const bestPrice = parseFloat(bestPriceText!.replace("$", ""));

  const rowPrices: number[] = [];
  for (let i = 0; i < rowCount; i++) {
    const text = await offerRows.nth(i).locator("span.text-lg").first().textContent();
    rowPrices.push(parseFloat(text!.replace("$", "")));
  }

  // Best price card holds the cheapest offer; remaining rows are ascending.
  for (const price of rowPrices) {
    expect(price).toBeGreaterThanOrEqual(bestPrice);
  }
  for (let i = 1; i < rowPrices.length; i++) {
    expect(rowPrices[i]).toBeGreaterThanOrEqual(rowPrices[i - 1]);
  }
});
