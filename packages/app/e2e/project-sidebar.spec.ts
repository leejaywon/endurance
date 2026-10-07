import { expect, test, type Page } from "@playwright/test"
import { fixture, pageMessages } from "./performance/timeline/session-timeline-stress.fixture"
import {
  installStressSessionTabs,
  installTimelineSettings,
  stressSessionHref,
} from "./performance/timeline/timeline-test-helpers"
import { mockOpenCodeServer, type MockServerConfig } from "./utils/mock-server"

const secondDirectory = "C:/OpenCode/second-project"
const secondProject = {
  ...fixture.project,
  id: "proj_sidebar_second",
  name: "second-project",
  worktree: secondDirectory,
}
const extraSessions = Array.from({ length: 6 }, (_, index) => ({
  ...fixture.sessions[0]!,
  id: `ses_sidebar_extra_${index}`,
  title: `Project session ${index + 1}`,
  time: { created: 1699999990000 - index, updated: 1699999990000 - index },
}))
const secondSession = {
  ...fixture.sessions[0]!,
  id: "ses_sidebar_second",
  title: "Second project chat",
  projectID: secondProject.id,
  directory: secondDirectory,
}

async function setup(
  page: Page,
  status?: Pick<MockServerConfig, "sessionStatus" | "events" | "eventRetry" | "sessions">,
) {
  await mockOpenCodeServer(page, {
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    sessions: [...fixture.sessions, ...extraSessions, secondSession],
    pageMessages,
    ...status,
  })
  await page.route("**/project", (route) => route.fulfill({ json: [fixture.project, secondProject] }))
  await installTimelineSettings(page)
  await installStressSessionTabs(page)
  await page.addInitScript(
    ({ directory, secondDirectory }) => {
      localStorage.setItem(
        "opencode.global.dat:server",
        JSON.stringify({
          projects: {
            local: [
              { worktree: directory, expanded: true },
              { worktree: secondDirectory, expanded: true },
            ],
          },
          lastProject: { local: directory },
        }),
      )
    },
    { directory: fixture.directory, secondDirectory },
  )
  await page.goto(stressSessionHref(fixture.sourceID))
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(page.locator('[data-action="project-sidebar-toggle"]')).toBeEnabled()
}

const sidebar = (page: Page) => page.locator('[data-component="project-sidebar"]')

async function chooseOrdering(page: Page, section: "Group by" | "Sort by", option: string) {
  await sidebar(page).getByRole("button", { name: "Group and sort", exact: true }).click()
  await page.getByRole("menuitem", { name: new RegExp(`^${section}`) }).click()
  await page.getByRole("menuitemradio", { name: option, exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: option, exact: true })).toBeHidden()
}
// Select the project wrapper explicitly; its nested sessions belong to that directory.
function group(page: Page, directory = fixture.directory) {
  return sidebar(page).locator(`[data-component="project-sidebar-group"][data-project="${directory}"]`)
}

test("groups and sorts from the header menu and remembers both selections", async ({ page }) => {
  await setup(page)
  await page.locator('[data-action="project-sidebar-toggle"]').click()
  const add = await sidebar(page).getByRole("button", { name: "Add project", exact: true }).boundingBox()
  const organize = sidebar(page).getByRole("button", { name: "Group and sort", exact: true })
  await expect(organize).toBeEnabled()
  const orderBox = await organize.boundingBox()
  expect(orderBox!.x).toBeGreaterThanOrEqual(add!.x + add!.width)
  await chooseOrdering(page, "Sort by", "Name")
  await expect(group(page).getByRole("link")).toHaveText([
    fixture.expected.targetTitle,
    "Project session 1",
    "Project session 2",
    "Project session 3",
    "Project session 4",
  ])
  await chooseOrdering(page, "Group by", "Date")
  await expect(sidebar(page).locator('[data-component="project-sidebar-group"]')).toHaveCount(0)
  await expect(sidebar(page).locator('[data-slot="project-sidebar-date"]')).toHaveText(["Older"])
  await expect(sidebar(page).getByRole("link")).toHaveText([
    fixture.expected.targetTitle,
    ...extraSessions.map((session) => session.title),
    "Second project chat",
    fixture.expected.sourceTitle,
  ])
  await page.reload()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await expect(sidebar(page).locator('[data-slot="project-sidebar-date"]')).toHaveText(["Older"])
  await organize.click()
  await expect(page.getByRole("menuitem", { name: "Group by Date", exact: true })).toBeVisible()
  await page.getByRole("menuitem", { name: "Sort by Name", exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: "Name", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("menu", { name: "Sort by Name", exact: true })).toHaveCSS("opacity", "1")
  await page.screenshot({ path: test.info().outputPath("project-sidebar-sort-menu.png") })
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await sidebar(page).getByRole("link", { name: fixture.expected.targetTitle, exact: true }).click()
  await expect(page).toHaveURL(stressSessionHref(fixture.targetID))
  await chooseOrdering(page, "Group by", "Folder")
  await expect(group(page).getByRole("button", { name: "smoke-project", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
})

test("uses the chosen timestamp for date groups and keeps the menu usable in a narrow dark window", async ({
  page,
}) => {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime()
  await setup(page, {
    sessions: [
      { ...fixture.sessions[0]!, time: { created: yesterday, updated: today + 2 } },
      { ...fixture.sessions[1]!, time: { created: today, updated: today + 1 } },
      { ...secondSession, time: { created: yesterday - 1, updated: yesterday } },
    ],
  })
  await page.locator('[data-action="project-sidebar-toggle"]').click()
  await chooseOrdering(page, "Group by", "Date")
  await expect(sidebar(page).locator('[data-slot="project-sidebar-date"]')).toHaveText(["Today", "Yesterday"])
  await expect(sidebar(page).getByRole("link")).toHaveText([
    fixture.expected.sourceTitle,
    fixture.expected.targetTitle,
    "Second project chat",
  ])
  await chooseOrdering(page, "Sort by", "Date created")
  await expect(sidebar(page).locator('[data-slot="project-sidebar-date"]')).toHaveText(["Today", "Yesterday", "Older"])
  await expect(sidebar(page).getByRole("link")).toHaveText([
    fixture.expected.targetTitle,
    fixture.expected.sourceTitle,
    "Second project chat",
  ])
  await page.emulateMedia({ colorScheme: "dark" })
  await page.setViewportSize({ width: 800, height: 600 })
  await sidebar(page).getByRole("button", { name: "Group and sort", exact: true }).click()
  await page.getByRole("menuitem", { name: "Group by Date", exact: true }).click()
  await expect(page.getByRole("menuitemradio", { name: "Date", exact: true })).toHaveAttribute("aria-checked", "true")
  await expect(page.getByRole("menu", { name: "Group by Date", exact: true })).toHaveCSS("opacity", "1")
  await page.screenshot({ path: test.info().outputPath("project-sidebar-group-menu-dark.png") })
  await page.getByRole("menuitemradio", { name: "Folder", exact: true }).click()
  await expect(group(page).getByRole("link")).toHaveText([fixture.expected.targetTitle, fixture.expected.sourceTitle])
  await chooseOrdering(page, "Sort by", "Last activity")
  await expect(group(page).getByRole("link")).toHaveText([fixture.expected.sourceTitle, fixture.expected.targetTitle])
})

test("toggles a persistent project panel without leaving the session and opens an indented session", async ({
  page,
}) => {
  await setup(page)
  const toggle = page.locator('[data-action="project-sidebar-toggle"]')
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(toggle).toHaveAttribute("aria-pressed", "true")
  await expect(toggle.locator("svg")).toHaveCSS(
    "color",
    await toggle.evaluate((button) => getComputedStyle(button).color),
  )
  await expect(sidebar(page)).toBeVisible()
  await expect(page).toHaveURL(stressSessionHref(fixture.sourceID))
  await expect(group(page).locator('[data-slot="project-folder-icon"]')).toBeVisible()
  await expect(group(page).getByRole("button", { name: "smoke-project", exact: true })).toHaveAttribute(
    "aria-expanded",
    "true",
  )
  const target = group(page).getByRole("link", { name: fixture.expected.targetTitle, exact: true })
  await expect(target).toBeVisible()
  await expect(
    group(page, secondDirectory).getByRole("link", { name: "Second project chat", exact: true }),
  ).toBeVisible()
  await expect(group(page).getByRole("link", { name: "Second project chat", exact: true })).toHaveCount(0)
  await expect(sidebar(page).getByRole("link", { name: "Inspect child navigation", exact: true })).toHaveCount(0)
  const headerBox = await group(page).locator('[data-component="home-project-row"]').boundingBox()
  const titleBox = await target.locator("span").boundingBox()
  expect(titleBox!.x).toBeGreaterThan(headerBox!.x + 24)
  await target.click()
  await expect(page).toHaveURL(stressSessionHref(fixture.targetID))
  await expect(target).toHaveAttribute("aria-current", "page")
  await expect(sidebar(page)).toBeVisible()
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toBeEditable()
  await page.screenshot({ path: test.info().outputPath("project-sidebar-desktop.png") })
  await toggle.click()
  await expect(sidebar(page)).toBeHidden()
  await expect(page).toHaveURL(stressSessionHref(fixture.targetID))
  const modifier = await page.evaluate(() => (/(Mac|iPod|iPhone|iPad)/.test(navigator.platform) ? "Meta" : "Control"))
  await page.keyboard.press(`${modifier}+b`)
  await expect(sidebar(page)).toBeVisible()
})

test("collapses each project, shows more sessions, and keeps its existing menu and new-session action", async ({
  page,
}) => {
  await setup(page)
  await page.locator('[data-action="project-sidebar-toggle"]').click()
  const row = group(page).getByRole("button", { name: "smoke-project", exact: true })
  await expect(group(page).locator('[data-component="project-sidebar-session"]')).toHaveCount(5)
  await group(page).getByRole("button", { name: "Load more", exact: true }).click()
  await expect(group(page).locator('[data-component="project-sidebar-session"]')).toHaveCount(8)
  await row.click()
  await expect(row).toHaveAttribute("aria-expanded", "false")
  await expect(group(page).locator('[data-component="project-sidebar-session"]')).toHaveCount(0)
  await expect(
    group(page, secondDirectory).getByRole("link", { name: "Second project chat", exact: true }),
  ).toBeVisible()
  await row.click()
  await expect(row).toHaveAttribute("aria-expanded", "true")
  await group(page).locator('[data-action="home-project-menu"]').click()
  await expect(page.getByRole("menuitem", { name: "Edit project", exact: true })).toBeVisible()
  await expect(page.getByRole("menuitem", { name: "Close", exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await group(page).locator('[data-action="home-project-new-session"]').click()
  await expect(page).toHaveURL(/\/new-session\?draftId=/)
  await expect(sidebar(page)).toBeVisible()
})

test("anchors Settings and Help at the bottom with aligned rows on desktop and a narrow window", async ({ page }) => {
  await setup(page)
  await page.emulateMedia({ colorScheme: "dark" })
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark")
  await page.locator('[data-action="project-sidebar-toggle"]').click()
  const settings = sidebar(page).getByRole("button", { name: "Settings", exact: true })
  const help = sidebar(page).getByRole("button", { name: "Help", exact: true })
  await expect(settings).toBeVisible()
  await expect(help).toBeVisible()
  const bounds = await sidebar(page).boundingBox()
  const settingsBox = await settings.boundingBox()
  const helpBox = await help.boundingBox()
  expect(settingsBox!.x).toBe(helpBox!.x)
  expect(settingsBox!.width).toBe(helpBox!.width)
  expect(settingsBox!.height).toBe(helpBox!.height)
  expect(bounds!.y + bounds!.height - helpBox!.y - helpBox!.height).toBeLessThan(16)
  await sidebar(page).screenshot({ path: test.info().outputPath("project-sidebar-dark.png") })
  await page.setViewportSize({ width: 500, height: 600 })
  await expect(settings).toBeVisible()
  await expect(help).toBeVisible()
  await page.screenshot({ path: test.info().outputPath("project-sidebar-narrow.png") })
  await settings.click()
  await expect(page.getByRole("dialog")).toBeVisible()
})

test("shares the tab loading animation beside each working session and removes it when idle", async ({ page }) => {
  const events: unknown[] = []
  await setup(page, { events: () => events.splice(0), eventRetry: 16 })
  await page.locator('[data-action="project-sidebar-toggle"]').click()
  const row = group(page).getByRole("link", { name: fixture.expected.targetTitle, exact: true })
  const indicator = row.locator('[data-component="session-progress-indicator-v2"]')
  const tab = page.locator(`[data-titlebar-tab-slot]:has(a[href="${stressSessionHref(fixture.targetID)}"])`)
  const tabIndicator = tab.locator('[data-component="session-progress-indicator-v2"]')
  await expect(row).toBeVisible()
  await expect(indicator).toHaveCount(0)
  await expect(tabIndicator).toHaveCount(0)
  events.push({
    directory: fixture.directory,
    payload: { type: "session.status", properties: { sessionID: fixture.targetID, status: { type: "busy" } } },
  })
  await expect(indicator).toBeVisible()
  await expect(tabIndicator).toBeVisible()
  await expect(
    group(page)
      .getByRole("link", { name: fixture.expected.sourceTitle, exact: true })
      .locator('[data-component="session-progress-indicator-v2"]'),
  ).toHaveCount(0)
  const titleBox = await row.locator("span").boundingBox()
  const iconBox = await indicator.boundingBox()
  expect(iconBox!.x).toBeGreaterThanOrEqual(titleBox!.x + titleBox!.width)
  const sidebarAnimation = await indicator.evaluate((icon) => getComputedStyle(icon).animation)
  const tabAnimation = await tabIndicator.evaluate((icon) => getComputedStyle(icon).animation)
  expect(sidebarAnimation).toBe(tabAnimation)
  expect(sidebarAnimation).toContain("tabler-loading-spin")
  await expect(indicator).toHaveAttribute("data-icon-source", "tabler")
  await sidebar(page).screenshot({ path: test.info().outputPath("project-sidebar-loading.png") })
  events.push({
    directory: fixture.directory,
    payload: { type: "session.status", properties: { sessionID: fixture.targetID, status: { type: "idle" } } },
  })
  await expect(indicator).toHaveCount(0)
  await expect(tabIndicator).toHaveCount(0)
  await expect(page).toHaveURL(stressSessionHref(fixture.sourceID))
})
