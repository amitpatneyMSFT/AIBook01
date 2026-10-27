import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Composed training videos in a real browser, against the real routes backed
 * by e2e/mock-llm.mjs. Azure Speech is not configured here, so timing falls
 * back to estimates and the render stops at the avatar — after the browser has
 * drawn and uploaded every visual, which is the part worth exercising.
 */

async function notebookWithSource(request: APIRequestContext): Promise<string> {
  const nb = await request.post("/api/notebooks", { data: { title: "Garden pilot" } });
  expect(nb.ok()).toBeTruthy();
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
  return id;
}

type Artifact = {
  id: string;
  content: {
    sections: { cues?: { kind: string; stat?: { value: string } }[] }[];
    composition?: {
      mode: string;
      animation: { transitions: boolean; pictures: boolean; bullets: boolean; layout: boolean };
    };
  };
};

test("plans visuals with the transcript, edits one and previews it on the timeline", async ({
  page,
  request,
}) => {
  const notebookId = await notebookWithSource(request);
  await page.goto(`/notebook/${notebookId}`);

  const card = page.getByTestId("training-card");
  await card.getByRole("button", { name: /^Options/ }).click();
  await expect(card.getByLabel("Training video style")).toHaveValue("composed");
  await card.getByRole("button", { name: "Generate Training video" }).click();

  const dialog = page.getByRole("dialog").last();
  const visualsTab = dialog.getByRole("tab", { name: "Visuals" });
  await expect(visualsTab).toBeVisible({ timeout: 30_000 });
  await visualsTab.click();

  // Three planned visuals survive; the one anchored to words never spoken is dropped.
  await expect(dialog.getByRole("button", { name: /^Title card/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Learning objectives/ })).toBeVisible();
  const stat = dialog.getByRole("button", { name: /^Key number/ });
  await expect(stat).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Quote/ })).toHaveCount(0);

  await stat.click();
  await expect(dialog.getByText("Found in the script")).toBeVisible();
  const number = dialog.getByRole("textbox", { name: "Number" });
  await number.fill("41%");

  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByText(/Estimated timing/)).toBeVisible();
  const marker = dialog.getByRole("button", { name: /^Key number at / });
  await expect(marker).toBeVisible();
  await marker.click();
  // Selecting a marker jumps back to its editor.
  await expect(dialog.getByRole("textbox", { name: "Number" })).toHaveValue("41%");

  await dialog.getByRole("tab", { name: "Design" }).click();
  const amount = dialog.getByLabel("Animation amount");
  await expect(amount).toHaveValue("full");
  await amount.selectOption("light");
  await expect(dialog.getByLabel("Visual transitions and fades")).toBeChecked();
  await expect(dialog.getByLabel("Slow push-in on pictures")).not.toBeChecked();
  await expect(dialog.getByLabel("Reveal bullet points one at a time")).not.toBeChecked();
  await expect(dialog.getByLabel("Glide the presenter between layouts")).not.toBeChecked();
  await dialog.getByLabel("Slow push-in on pictures").check();
  await expect(amount).toHaveValue("custom");
  await amount.selectOption("none");
  await expect(dialog.getByLabel("Visual transitions and fades")).not.toBeChecked();
  await dialog.getByRole("tab", { name: "Preview" }).click();
  await expect(dialog.getByRole("img", { name: /^Preview of the composed/ })).toBeVisible();

  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Saved" })).toBeVisible();

  const list = await request.get(`/api/notebooks/${notebookId}`);
  const { artifacts } = (await list.json()) as { artifacts: { id: string; type: string }[] };
  const training = artifacts.find((a) => a.type === "training")!;
  const saved = (await (await request.get(`/api/artifacts/${training.id}`)).json()) as Artifact;
  expect(saved.content.composition?.mode).toBe("composed");
  expect(saved.content.composition?.animation).toEqual({
    transitions: false, pictures: false, bullets: false, layout: false,
  });
  const cues = saved.content.sections.flatMap((s) => s.cues ?? []);
  expect(cues.map((c) => c.kind)).toEqual(["title", "objectives", "stat"]);
  expect(cues[2].stat?.value).toBe("41%");
});

test("draws every visual in the browser before handing the render to the avatar", async ({
  page,
  request,
}) => {
  const notebookId = await notebookWithSource(request);
  await page.goto(`/notebook/${notebookId}`);
  await page.getByRole("button", { name: "Generate Training video" }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog.getByRole("tab", { name: "Visuals" })).toBeVisible({ timeout: 30_000 });

  const list = await request.get(`/api/notebooks/${notebookId}`);
  const { artifacts } = (await list.json()) as { artifacts: { id: string; type: string }[] };
  const id = artifacts.find((a) => a.type === "training")!.id;

  // The server refuses to render before the visuals exist, and refuses drawings it did not ask for.
  const early = await request.post(`/api/training/${id}/render`);
  expect(early.status()).toBe(409);
  const before = (await (await request.get(`/api/training/${id}/raster`)).json()) as { missing: unknown[] };
  expect(before.missing.length).toBeGreaterThan(5);
  const bogus = await request.put(`/api/training/${id}/raster`, {
    data: { key: "0123456789abcdef", state: 0, dataUrl: "data:image/png;base64,AAAA" },
  });
  expect(bogus.status()).toBe(409);

  await dialog.getByRole("button", { name: "Render video" }).click();
  // No Azure Speech here: the render stops at the avatar, after the drawing.
  await expect(dialog.getByText(/Azure Speech resource/)).toBeVisible({ timeout: 45_000 });

  const after = (await (await request.get(`/api/training/${id}/raster`)).json()) as { missing: unknown[] };
  expect(after.missing).toEqual([]);
});
