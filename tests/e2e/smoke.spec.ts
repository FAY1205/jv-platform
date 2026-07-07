import { test, expect } from "@playwright/test";

// WP-001: the home page renders and identifies the product.
test("home page renders the product name", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /TerritoryDesk/i })).toBeVisible();
});
