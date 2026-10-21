import { expect, test } from "@playwright/test";

/**
 * The live VASA-2 presenter, in a browser. Azure Speech is not configured in
 * e2e, so this covers the panel and its guard rails, not an actual stream.
 */
test("the live presenter speaks the generated transcript, with nothing to type", async ({
  page,
  request,
}) => {
  const nb = await request.post("/api/notebooks", { data: { title: "Live presenter" } });
  const { id } = (await nb.json()) as { id: string };
  const src = await request.post(`/api/notebooks/${id}/sources`, {
    data: {
      title: "Garden notes",
      text:
        "The Riverside garden pilot builds 24 raised beds in April 2025. " +
        "A drip kit costs $640 and uses about 40% less water than hand watering.",
    },
  });
  expect(src.ok()).toBeTruthy();
  await page.goto(`/notebook/${id}`);

  const card = page.getByTestId("training-card");
  await card.getByRole("button", { name: "Generate Training video" }).click();

  const editor = page.getByRole("dialog").last();
  await editor.getByRole("button", { name: "Preview live (VASA-2)" }).click({ timeout: 30_000 });

  const dialog = page.getByRole("dialog", { name: "Live presenter" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio")).toHaveCount(4);
  await expect(dialog.getByRole("radio", { name: "Leonie Professional" })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(/Azure Speech/);
  await expect(dialog.getByRole("button", { name: "Start session" })).toBeDisabled();

  // The words come from the transcript; there is no box to type them in.
  await expect(dialog.getByRole("textbox")).toHaveCount(0);
  await expect(
    dialog.getByRole("list", { name: "Transcript" }).getByRole("listitem"),
  ).not.toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the trainer pickers never offer VASA-2 presenters", async ({ page, request }) => {
  const nb = await request.post("/api/notebooks", { data: { title: "Live presenter pickers" } });
  const { id } = (await nb.json()) as { id: string };
  await page.goto(`/notebook/${id}`);

  const card = page.getByTestId("training-card");
  await card.getByRole("button", { name: /^Options/ }).click();
  const options = await card.getByLabel("Trainer").locator("option").allTextContents();
  expect(options.some((o) => /VASA-2/.test(o))).toBe(false);
});
