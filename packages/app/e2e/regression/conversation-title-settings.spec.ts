import { expect, test, type Page } from "@playwright/test"
import type { Config } from "@opencode-ai/sdk/v2/client"
import { setupTimeline } from "../performance/timeline-stability/fixture"

async function setup(page: Page, title: NonNullable<Config["agent"]>[string] = {}) {
  await setupTimeline(page)
  const state = {
    config: { small_model: "ollama/other-model", agent: { title } },
    patches: [] as Config[],
    fail: false,
  }
  await page.route("**/global/config", async (route) => {
    if (route.request().method() === "PATCH") {
      if (state.fail) return route.fulfill({ status: 500, json: { message: "Save failed" } })
      const patch = route.request().postDataJSON() as Config
      state.patches.push(patch)
      state.config.agent.title = { ...state.config.agent.title, ...patch.agent?.title }
    }
    return route.fulfill({ json: state.config })
  })
  await page.route(/\/provider(?:\?.*)?$/, (route) =>
    route.fulfill({
      json: {
        all: [
          {
            id: "opencode",
            name: "OpenCode",
            models: {
              "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } },
            },
          },
          {
            id: "ollama",
            name: "Local Ollama",
            models: {
              "qwen-test:latest": { id: "qwen-test:latest", name: "Local Qwen", limit: { context: 32_768 } },
            },
          },
        ],
        connected: ["opencode", "ollama"],
        default: { providerID: "opencode", modelID: "claude-opus-4-6" },
      },
    }),
  )
  await page.reload()
  await page.keyboard.press("Control+,")
  const dialog = page.locator(".settings-v2-dialog")
  await expect(dialog.getByRole("heading", { name: "General", exact: true })).toBeVisible()
  return { state, dialog }
}

test("title settings default to first message and save an explicit model without changing the chat model", async ({
  page,
}) => {
  const { state, dialog } = await setup(page)
  const mode = dialog.locator('[data-action="settings-conversation-title"]')
  const source = dialog.locator('[data-action="settings-title-model-source"]')
  const model = dialog.locator('[data-action="settings-title-model"]')
  await expect(mode).toHaveText("First message")
  await expect(source).toHaveCount(0)
  await expect.poll(() => state.patches.length).toBe(0)
  await dialog.screenshot({ path: test.info().outputPath("title-first-message.png") })

  await mode.getByRole("button").click()
  await expect(mode.getByRole("button")).toHaveAttribute("aria-expanded", "true")
  await expect(
    page.locator('[data-slot="select-v2-content"]').getByText("Generate with AI", { exact: true }),
  ).toBeVisible()
  await page.locator('[data-slot="select-v2-content"]').getByText("Generate with AI", { exact: true }).click()
  await expect(mode).toHaveText("Generate with AI")
  await expect(source).toHaveText("Current conversation model")
  expect(state.patches).toEqual([{ agent: { title: { disable: false } } }])
  await source.getByRole("button").click()
  await page.locator('[data-slot="select-v2-content"]').getByText("Choose another model", { exact: true }).click()
  await expect(model).toHaveText("Choose model")
  expect(state.patches).toHaveLength(1)
  await model.click()
  await page.getByPlaceholder("Search models").fill("Local Qwen")
  await expect(page.locator('[data-option-key="ollama:qwen-test:latest"]')).toContainText("Local Qwen")
  await page.locator('[data-option-key="ollama:qwen-test:latest"]').click()
  await expect(model).toHaveText("Local Ollama / Local Qwen")
  expect(state.config.agent.title.model).toBe("ollama/qwen-test:latest")
  expect(state.config.small_model).toBe("ollama/other-model")
  await dialog.screenshot({ path: test.info().outputPath("title-custom-model.png") })

  await page.reload()
  await page.keyboard.press("Control+,")
  await expect(mode).toHaveText("Generate with AI")
  await expect(model).toHaveText("Local Ollama / Local Qwen")
  await source.getByRole("button").click()
  await page.locator('[data-slot="select-v2-content"]').getByText("Current conversation model", { exact: true }).click()
  await expect(source).toHaveText("Current conversation model")
  await expect(model).toHaveCount(0)
  expect(state.config.agent.title.model).toBe("")
  await mode.getByRole("button").click()
  await page.locator('[data-slot="select-v2-content"]').getByText("First message", { exact: true }).click()
  await expect(mode).toHaveText("First message")
  expect(state.config.agent.title.disable).toBe(true)
  await page.keyboard.press("Escape")
  await expect(page.locator('[data-action="prompt-model"]')).toContainText("Claude Opus 4.6")
})

test("unavailable title models remain explicit and a failed save preserves the saved setting", async ({ page }) => {
  const { state, dialog } = await setup(page, { disable: false, model: "missing/provider/model" })
  await expect(dialog.locator('[data-action="settings-title-model"]')).toHaveText("missing/provider/model")
  await expect(dialog.getByText("This model is unavailable. Choose a connected model to generate titles")).toBeVisible()
  state.fail = true
  const mode = dialog.locator('[data-action="settings-conversation-title"]')
  await mode.getByRole("button").click()
  await page.locator('[data-slot="select-v2-content"]').getByText("First message", { exact: true }).click()
  await expect(page.getByText("Request failed", { exact: true })).toBeVisible()
  await expect(mode).toHaveText("Generate with AI")
  expect(state.config.agent.title).toEqual({ disable: false, model: "missing/provider/model" })
  expect(state.patches).toHaveLength(0)
})
