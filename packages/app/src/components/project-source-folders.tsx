import { createResource, createSignal, For, Show, onMount, onCleanup } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { getFilename } from "@opencode-ai/core/util/path"
import { showToast } from "@/utils/toast"
import "./project-source-folders.css"
import type { createEditProjectModel } from "./edit-project"

type Entry = { name: string; path: string; directory: boolean; symlink: boolean }
export function ProjectSourceFolders(props: { model: ReturnType<typeof createEditProjectModel>; directory: string }) {
  const platform = usePlatform()
  const language = useLanguage()
  const controls = () => props.model.store.controls
  const [choosing, setChoosing] = createSignal(false)
  const paths = () => [props.directory, ...controls().sourceFolders.filter((path) => path !== props.directory)]
  const [availability, { refetch: refreshFolders }] = createResource(
    () => JSON.stringify(paths()),
    () => platform.projectControls!.folders(paths()),
  )
  const scans = new Set<() => Promise<void>>()
  const [refresh, setRefresh] = createStore({ busy: false })
  const refreshTree = async () => {
    if (refresh.busy) return
    setRefresh("busy", true)
    try {
      await Promise.allSettled([refreshFolders(), ...Array.from(scans, (scan) => scan())])
    } finally {
      setRefresh("busy", false)
    }
  }
  onMount(() => {
    const focus = () => void refreshTree()
    const visible = () => {
      if (!document.hidden) focus()
    }
    const timer = window.setInterval(visible, 2000)
    window.addEventListener("focus", focus)
    document.addEventListener("visibilitychange", visible)
    onCleanup(() => {
      clearInterval(timer)
      window.removeEventListener("focus", focus)
      document.removeEventListener("visibilitychange", visible)
    })
  })
  const failure = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  const updateFolders = (paths: string[]) => {
    props.model.setStore("controls", "sourceFolders", paths)
    props.model.setStore("controlsDirty", true)
  }
  const choose = async (replace?: string) => {
    if (platform.platform !== "desktop" || choosing()) return
    setChoosing(true)
    try {
      const selected = await platform.openDirectoryPickerDialog({ multiple: !replace })
      if (!selected) return
      const inspected = await platform.projectControls!.folders(Array.isArray(selected) ? selected : [selected])
      if (inspected.some((folder) => !folder.available)) throw new Error(language.t("project.sources.unavailable"))
      if (replace === props.directory) {
        await props.model.prepareLifecycle("relocate", inspected[0].path)
        return
      }
      const defaults = await platform.projectControls!.defaults()
      const sourceAccess = { ...controls().sourceAccess }
      for (const folder of inspected)
        if (!controls().sourceFolders.includes(folder.path))
          sourceAccess[folder.path] = replace ? (sourceAccess[replace] ?? "read") : defaults.folder
      if (replace) {
        const next = inspected[0].path
        for (const key of ["excluded", "readOnly", "deviceOnly", "customAccess"] as const)
          props.model.setStore(
            "controls",
            key,
            (controls()[key] ?? []).map((entry) =>
              entry === replace ? next : entry.startsWith(replace + "/") ? next + entry.slice(replace.length) : entry,
            ),
          )
        delete sourceAccess[replace]
      }
      props.model.setStore("controls", "sourceAccess", sourceAccess)
      updateFolders(
        [
          ...new Set([
            ...controls().sourceFolders.filter((path) => path !== replace),
            ...inspected.map((folder) => folder.path),
          ]),
        ].filter((path) => path !== props.directory),
      )
    } finally {
      setChoosing(false)
    }
  }
  const relative = (value: string) =>
    value === props.directory
      ? "."
      : value.startsWith(props.directory + "/")
        ? value.slice(props.directory.length + 1)
        : value
  const within = (base: string, target: string) =>
    (base === "." && !target.startsWith("/")) || base === target || target.startsWith(base + "/")
  const rule = (path: string) =>
    controls().excluded.some((entry) => within(relative(entry), path)) ||
    controls().sourceFolders.some((folder) => within(folder, path) && controls().sourceAccess[folder] === "none")
      ? "none"
      : controls().sourceFolders.some(
            (entry) => within(entry, path) && (controls().sourceAccess[entry] ?? "read") === "read",
          ) || controls().readOnly.some((entry) => within(relative(entry), path))
        ? "read"
        : "inherit"
  const label = (value: string) =>
    language.t(
      value === "none" ? "project.files.none" : value === "read" ? "project.files.read" : "project.files.inherit",
    )
  const accessLabel = (value: string) => (value === "inherit" ? language.t("project.files.write") : label(value))
  const color = (value: string) => (value === "none" ? "#ef4444" : value === "read" ? "#f97316" : "#84cc16")
  function inherited(path: string) {
    if (
      controls().excluded.some((entry) => relative(entry) !== path && within(relative(entry), path)) ||
      controls().sourceFolders.some(
        (folder) => folder !== path && within(folder, path) && controls().sourceAccess[folder] === "none",
      )
    )
      return "none"
    if (
      controls().sourceFolders.some(
        (entry) => entry !== path && within(entry, path) && (controls().sourceAccess[entry] ?? "read") === "read",
      ) ||
      controls().readOnly.some((entry) => relative(entry) !== path && within(relative(entry), path))
    )
      return "read"
    return "inherit"
  }
  function apply(path: string, value: string) {
    const source = controls().sourceFolders.includes(path)
    if (source)
      props.model.setStore("controls", "sourceAccess", path, value === "inherit" ? "write" : (value as "read" | "none"))
    for (const key of ["excluded", "readOnly"] as const) {
      const remaining = controls()[key].filter((entry) => relative(entry) !== path)
      props.model.setStore("controls", key, [
        ...new Set([
          ...remaining,
          ...(!source && ((key === "excluded" && value === "none") || (key === "readOnly" && value === "read"))
            ? [path]
            : []),
        ]),
      ])
    }
    props.model.setStore("controls", "customAccess", [
      ...new Set([
        ...(controls().customAccess ?? []).filter((entry) => relative(entry) !== path),
        ...(!source ? [path] : []),
      ]),
    ])
    props.model.setStore("controlsDirty", true)
  }
  function AccessControls(access: { path: string; unavailable?: boolean }) {
    const blocked = (value: string) =>
      (inherited(access.path) === "none" && value !== "none") ||
      (inherited(access.path) === "read" && value === "inherit")
    const root = () => access.path === "." || controls().sourceFolders.includes(access.path)
    const own = () =>
      [...controls().excluded, ...controls().readOnly, ...(controls().customAccess ?? [])].some(
        (path) => relative(path) === access.path,
      )
    const origin = () => {
      if (own() && rule(access.path) === "inherit") return access.path
      const candidates = [
        ...controls().excluded.map((path) => ({ path: relative(path), value: "none" })),
        ...controls().readOnly.map((path) => ({ path: relative(path), value: "read" })),
        ...controls().sourceFolders.map((path) => ({ path, value: controls().sourceAccess[path] ?? "read" })),
      ].filter((entry) => within(entry.path, access.path) && entry.value === rule(access.path))
      return (
        candidates.sort((a, b) => b.path.length - a.path.length)[0]?.path ??
        controls()
          .sourceFolders.filter((path) => within(path, access.path))
          .sort((a, b) => b.length - a.length)[0] ??
        "."
      )
    }
    const originLabel = () =>
      language.t(origin() === access.path ? "project.files.setHere" : "project.files.inheritedFrom", {
        path: origin() === "." ? props.directory : origin(),
      })
    const toggleLabel = () => language.t(own() ? "project.files.inheritAction" : "project.files.customize")
    const reset = () => {
      for (const key of ["excluded", "readOnly"] as const)
        props.model.setStore(
          "controls",
          key,
          controls()[key].filter((path) => relative(path) !== access.path),
        )
      props.model.setStore(
        "controls",
        "customAccess",
        (controls().customAccess ?? []).filter((path) => relative(path) !== access.path),
      )
      props.model.setStore("controlsDirty", true)
    }
    return (
      <div class="project-access-controls">
        <div class="project-access-actions" role="group" aria-label={language.t("project.files.access")}>
          <For each={["inherit", "read", "none"]}>
            {(value) => (
              <div class="project-access-choice" data-selected={rule(access.path) === value}>
                <TooltipV2
                  placement="top"
                  openDelay={250}
                  value={
                    blocked(value)
                      ? `${accessLabel(value)} — ${language.t("project.files.parentRestricted")}`
                      : accessLabel(value)
                  }
                >
                  <button
                    type="button"
                    class="project-access-button"
                    aria-label={accessLabel(value)}
                    aria-pressed={rule(access.path) === value}
                    disabled={access.unavailable || blocked(value)}
                    style={{ "--access-color": color(value) }}
                    onClick={() => apply(access.path, value)}
                  >
                    <Icon
                      name={value === "none" ? "circle-ban-sign" : value === "read" ? "eye" : "pencil-line"}
                      size="small"
                      style={{ color: "var(--access-color)" }}
                    />
                  </button>
                </TooltipV2>
              </div>
            )}
          </For>
        </div>
        <TooltipV2 placement="top" openDelay={250} value={originLabel()}>
          <span
            data-access={rule(access.path) === "inherit" ? "write" : rule(access.path)}
            class="project-access-label text-12-regular text-text-base"
            tabindex="0"
            aria-label={`${accessLabel(rule(access.path))}. ${originLabel()}`}
          >
            {accessLabel(rule(access.path))}
          </span>
        </TooltipV2>
        <span class="project-access-origin">
          <Show when={!root()}>
            <TooltipV2 placement="top" openDelay={250} value={toggleLabel()}>
              <IconButtonV2
                type="button"
                size="normal"
                variant="neutral"
                class="project-access-parent-toggle"
                aria-label={toggleLabel()}
                aria-pressed={!own()}
                disabled={access.unavailable}
                icon={<Icon name="folder-down" size="normal" />}
                onClick={() => (own() ? reset() : apply(access.path, rule(access.path)))}
              />
            </TooltipV2>
          </Show>
        </span>
      </div>
    )
  }
  function Folder(folder: { path: string; depth: number; base: string; onError: (error: boolean) => void }) {
    const [state, setState] = createStore({
      entries: [] as Entry[],
      loading: false,
      loaded: false,
      more: false,
      error: false,
      pages: 1,
    })
    let disposed = false
    let pending: Promise<void> | undefined
    const scan = (): Promise<void> => {
      if (pending) return pending
      setState("loading", true)
      pending = (async () => {
        try {
          if (!platform.projectControls?.entries) throw new Error(language.t("project.files.restart"))
          const entries: Entry[] = []
          let more = false
          for (let page = 0; page < state.pages; page++) {
            const result = await platform.projectControls.entries(folder.base, folder.path, entries.length)
            if (disposed) return
            entries.push(...result.entries)
            more = result.more
            if (!more || !result.entries.length) break
          }
          if (disposed) return
          // Reconcile by path so unchanged rows retain expansion and keyboard focus.
          setState("entries", reconcile(entries, { key: "path" }))
          setState({ more, loaded: true, error: false })
          folder.onError(false)
        } catch {
          if (disposed) return
          setState({ error: true, entries: [], more: false })
          folder.onError(true)
        } finally {
          if (!disposed) setState("loading", false)
          pending = undefined
        }
      })()
      return pending
    }
    onMount(() => {
      scans.add(scan)
      void scan()
    })
    onCleanup(() => {
      disposed = true
      scans.delete(scan)
    })
    return (
      <>
        <For each={state.entries}>{(entry) => <Row entry={entry} depth={folder.depth} base={folder.base} />}</For>
        <Show when={state.loading && !state.loaded}>
          <p class="p-2 text-12-regular text-text-weak">{language.t("project.files.loading")}</p>
        </Show>
        <Show when={!state.error && state.more}>
          <ButtonV2
            type="button"
            variant="ghost-muted"
            disabled={state.loading}
            onClick={() => {
              setState("pages", (pages) => pages + 1)
              void scan()
            }}
          >
            {language.t("project.files.more")}
          </ButtonV2>
        </Show>
        <Show when={!state.error && state.loaded && !state.entries.length && !state.loading}>
          <p class="p-2 text-12-regular text-text-weak">{language.t("project.files.empty")}</p>
        </Show>
      </>
    )
  }
  function Row(row: { entry: Entry; depth: number; base: string }) {
    const [failed, setFailed] = createSignal(false)
    const target = () => (row.base === props.directory ? row.entry.path : row.base + "/" + row.entry.path)
    const [open, setOpen] = createSignal(false)
    return (
      <>
        <div
          class="project-access-row flex items-center gap-2 min-h-9 pr-2 hover:bg-v2-overlay-simple-overlay-hover"
          style={{ "padding-left": `${8 + row.depth * 16}px` }}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 py-1 text-left rounded outline-none focus-visible:outline-v2-border-border-focus"
            aria-expanded={row.entry.directory ? open() : undefined}
            onClick={() => row.entry.directory && setOpen(!open())}
          >
            <span class="w-3 shrink-0 text-text-weak">{row.entry.directory ? (open() ? "⌄" : "›") : ""}</span>
            <Icon name={row.entry.directory ? "folder" : "file"} size="small" />
            <span class="truncate" title={row.entry.path}>
              {row.entry.name}
              {row.entry.symlink ? " ↗" : ""}
            </span>
          </button>
          <Show when={failed()}>
            <span class="text-12-regular text-text-weak">{language.t("project.sources.unavailable")}</span>
          </Show>
          <AccessControls path={target()} unavailable={failed()} />
        </div>
        <Show when={open() && row.entry.directory}>
          <Folder path={row.entry.path} depth={row.depth + 1} base={row.base} onError={setFailed} />
        </Show>
      </>
    )
  }
  function RootFolder(root: { path: string; index: number }) {
    const [open, setOpen] = createSignal(false)
    const [failed, setFailed] = createSignal(false)
    const unavailable = () =>
      !!availability.error ||
      (!availability.error && availability()?.find((folder) => folder.path === root.path)?.available === false) ||
      failed()
    const target = () => relative(root.path)
    return (
      <div>
        <div class="project-access-row flex flex-wrap items-center gap-2 p-3">
          <button
            type="button"
            class="min-w-0 flex-1 flex items-center gap-2 text-left outline-none focus-visible:outline-v2-border-border-focus"
            classList={{ "basis-full": unavailable() }}
            aria-expanded={unavailable() ? undefined : open()}
            disabled={unavailable()}
            onClick={() => {
              setFailed(false)
              setOpen(!open())
              void refreshFolders()
            }}
            title={root.path}
          >
            <span class="w-3 shrink-0 text-text-weak">{open() ? "⌄" : "›"}</span>
            <Icon name="folder" size="small" />
            <span class="truncate">{getFilename(root.path)}</span>
          </button>
          <Show when={unavailable()}>
            <span
              class="text-12-regular shrink-0 inline-flex items-center gap-1 text-icon-warning-base"
              title={language.t("project.files.failed")}
            >
              <Icon name="warning" size="small" />
              {language.t("project.sources.unavailable")}
            </span>
          </Show>
          <AccessControls path={target()} unavailable={unavailable()} />
          <Show when={unavailable()}>
            <TooltipV2 value={language.t("project.sources.refresh")}>
              <IconButtonV2
                type="button"
                variant="neutral"
                aria-label={language.t("project.sources.refresh")}
                disabled={refresh.busy}
                icon={<Icon name="reset" size="small" />}
                onClick={() => {
                  setFailed(false)
                  void refreshTree()
                }}
              />
            </TooltipV2>
            <Show when={root.index > 0 || props.model.lifecycleAvailable()}>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                disabled={choosing()}
                onClick={() => void choose(root.path).catch(failure)}
              >
                {language.t("project.sources.locate")}
              </ButtonV2>
            </Show>
          </Show>
          <Show when={root.index > 0}>
            <ButtonV2
              type="button"
              variant="ghost-muted"
              aria-label={language.t("project.sources.remove")}
              onClick={() => {
                updateFolders(controls().sourceFolders.filter((path) => path !== root.path))
              }}
            >
              <Icon name="close" size="small" />
            </ButtonV2>
          </Show>
        </div>
        <Show
          when={
            open() &&
            !availability.error &&
            availability()?.find((folder) => folder.path === root.path)?.available !== false
          }
        >
          <div class="pb-3">
            <Folder base={root.path} path="." depth={1} onError={setFailed} />
          </div>
        </Show>
      </div>
    )
  }
  return (
    <Show when={props.model.controlsAvailable()}>
      <section class="flex flex-col gap-3 pt-3">
        <div class="flex items-center justify-between gap-3">
          <h3
            class="text-14-medium flex flex-wrap items-center gap-x-2 gap-y-1"
            aria-label={language.t("project.sources.title")}
          >
            <span class="inline-flex items-center gap-2">
              <Icon name="folders" size="small" />
              {language.t("project.sources.foldersLabel")}
            </span>
            <span aria-hidden="true">&amp;</span>
            <span class="inline-flex items-center gap-2">
              <Icon name="shield" size="small" />
              {language.t("project.sources.accessLabel")}
            </span>
          </h3>
          <div class="flex items-center gap-1">
            <TooltipV2 value={language.t("project.sources.refresh")}>
              <ButtonV2
                type="button"
                variant="ghost-muted"
                disabled={refresh.busy}
                aria-label={language.t("project.sources.refresh")}
                onClick={() => void refreshTree()}
              >
                <Icon name="reset" size="small" />
              </ButtonV2>
            </TooltipV2>
            <ButtonV2
              type="button"
              variant="ghost-muted"
              disabled={choosing()}
              onClick={() => void choose().catch(failure)}
            >
              <Icon name="folder-add-left" size="small" />
              {language.t("project.sources.add")}
            </ButtonV2>
          </div>
        </div>
        <Show when={props.model.controls.error}>
          <p role="alert">{language.t("project.controls.loadError")}</p>
        </Show>
        <Show when={!props.model.controls.error && props.model.controls()}>
          <div class="rounded-lg border border-border-weak-base overflow-hidden divide-y divide-border-weak-base">
            <For each={paths()}>{(path, index) => <RootFolder path={path} index={index()} />}</For>
          </div>
        </Show>
      </section>
    </Show>
  )
}
