import { afterEach, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { ProjectControls } from "../../src/project-controls"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function setup() {
  const root = await mkdtemp(path.join(tmpdir(), "endurance-controls-"))
  roots.push(root)
  const project = path.join(root, "project")
  await mkdir(path.join(project, "src"), { recursive: true })
  return { root, project, storage: path.join(root, "settings") }
}

test("defaults preserve existing projects, explicit empty providers deny every provider", async () => {
  const { project, storage } = await setup()
  expect(ProjectControls.providerAllowed(await ProjectControls.read(project, storage), "openai")).toBe(true)
  await ProjectControls.save(project, { providers: [] }, storage)
  expect(ProjectControls.providerAllowed(await ProjectControls.read(project, storage), "openai")).toBe(false)
})

test("settings follow canonical directory and descendants but not sibling projects", async () => {
  const { root, project, storage } = await setup()
  await ProjectControls.save(project, { providers: ["approved"], memory: "Use the project glossary" }, storage)
  await symlink(project, path.join(root, "alias"))
  await mkdir(path.join(root, "other"))
  expect((await ProjectControls.read(path.join(project, "src"), storage)).providers).toEqual(["approved"])
  expect((await ProjectControls.read(path.join(root, "alias"), storage)).memory).toBe("Use the project glossary")
  expect((await ProjectControls.read(path.join(root, "other"), storage)).memory).toBe("")
})

test("rejects malformed persisted settings instead of falling back to allow", async () => {
  const { project, storage } = await setup()
  await ProjectControls.save(project, {}, storage)
  const [name] = await readdir(storage)
  await writeFile(path.join(storage, name), '{"providers":"*"}')
  await expect(ProjectControls.read(project, storage)).rejects.toThrow()
})

test("saves atomically, privately, and deletion of memory does not leave an old copy", async () => {
  const { project, storage } = await setup()
  await ProjectControls.save(project, { memory: "old project memory" }, storage)
  await ProjectControls.save(project, { memory: "" }, storage)
  const files = await readdir(storage)
  expect(files).toHaveLength(1)
  expect(await readFile(path.join(storage, files[0]), "utf8")).not.toContain("old project memory")
  expect((await stat(path.join(storage, files[0]))).mode & 0o777).toBe(0o600)
})

test("command and extension limits cannot be widened by selecting an agent", async () => {
  const { project, storage } = await setup()
  await ProjectControls.save(project, { commands: false, networkTools: false }, storage)
  const value = await ProjectControls.read(project, storage)
  for (const action of ["bash", "shell", "task", "external_directory", "webfetch", "custom_mcp"])
    expect(ProjectControls.actionAllowed(value, action)).toBe(false)
  expect(ProjectControls.actionAllowed(value, "read")).toBe(true)
})

test("comparison sessions disable tools durably without modifying project settings", async () => {
  const { project, storage } = await setup()
  await ProjectControls.save(project, { memory: "Original instructions" }, storage)
  expect(await ProjectControls.isComparison("ses_original", storage)).toBe(false)
  await ProjectControls.markComparison("ses_comparison", storage)
  expect(await ProjectControls.isComparison("ses_comparison", storage)).toBe(true)
  expect(await ProjectControls.isComparison("ses_original", storage)).toBe(false)
  expect((await ProjectControls.read(project, storage)).memory).toBe("Original instructions")
  await expect(ProjectControls.markComparison("../outside", storage)).rejects.toThrow()
})
