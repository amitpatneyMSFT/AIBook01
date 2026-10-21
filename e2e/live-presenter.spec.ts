import { expect, test } from "@playwright/test";

/**
 * The live VASA-2 presenter, in a browser. Azure Speech is not configured in
 * e2e, so this covers the panel and its guard rails, not an actual stream.
 */
test("the live presenter lists the VASA-2 heads and explains a missing Speech resource", async ({
  page,
  request,
}) => {
  const nb = await request.post("/api/notebooks", { data: { title: "Live presenter" } });
  const { id } = (await nb.json()) as { id: string };
  await page.goto(`/notebook/${id}`);

  const card = page.getByTestId("training-card");
  await card.getByRole("button", { name: /^Options/ }).click();
  await card.getByRole("button", { name: "Try a live VASA-2 presenter" }).click();

  const dialog = page.getByRole("dialog", { name: "Live presenter" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await expect(dialog.getByRole("radio", { name: "Leonie Professional" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/Azure Speech/);
  await expect(dialog.getByRole("button", { name: "Start session" })).toBeDisabled();

  // The batch pickers never offer VASA-2 presenters.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  const options = await card.getByLabel("Trainer").locator("option").allTextContents();
  expect(options.some((o) => /VASA-2/.test(o))).toBe(false);
});
