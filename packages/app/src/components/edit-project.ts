import { useNavigate } from "@solidjs/router"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { usePlatform } from "@/context/platform"
import { ProjectControls } from "@opencode-ai/core/project-controls/schema"
import { getFilename } from "@opencode-ai/core/util/path"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { useMutation } from "@tanstack/solid-query"
import { normalizeProjectInfo } from "@/context/global-sync/utils"
import { createEffect, createMemo, createResource } from "solid-js"
import { createStore, unwrap } from "solid-js/store"
import { useGlobal } from "@/context/global"
import { type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"

export function createEditProjectModel(props: { project: LocalProject; server: ServerConnection.Any }) {
  const dialog = useDialog()
  const navigate = useNavigate()
  const language = useLanguage()
  const global = useGlobal()
  const platform = usePlatform()
  const controlsAvailable = () =>
    !!platform.projectControls && props.server.type === "sidecar" && props.server.variant === "base"
  const [controls] = createResource(controlsAvailable, () => platform.projectControls!.read(props.project.worktree))
  const serverCtx = createMemo(() => global.ensureServerCtx(props.server))
  const folderName = createMemo(() => getFilename(props.project.worktree))
  const defaultName = createMemo(() => props.project.name || folderName())
  const [store, setStore] = createStore({
    controls: ProjectControls.parse({}),
    controlsDirty: false,
    name: defaultName(),
    startup: props.project.commands?.start ?? "",
  })
  createEffect(() => {
    if (controls.error) return
    const value = controls()
    if (value) setStore("controls", ProjectControls.parse(value))
  })
  async function saveControls() {
    if (!controlsAvailable() || !store.controlsDirty) return
    if (controls.loading || controls.error || !controls()) throw new Error(language.t("project.controls.loadError"))
    await platform.projectControls!.save(props.project.worktree, structuredClone(unwrap(store.controls)))
    setStore("controlsDirty", false)
  }

  const [lifecycle, setLifecycle] = createStore({
    mode: "" as "" | "delete" | "relocate",
    pending: false,
    target: "",
    count: 0,
    token: "",
    busy: false,
    error: "",
  })
  const lifecycleAvailable = () => controlsAvailable() && !!platform.projectControls?.lifecycle
  const prepareLifecycle = async (mode: "delete" | "relocate", target = "") => {
    if (lifecycle.pending) return
    setLifecycle({ mode, target, pending: true, error: "", token: "" })
    try {
      const result = await platform.projectControls!.lifecycle({
        action: "preview",
        directory: props.project.worktree,
        projectID: props.project.id,
      })
      setLifecycle({ count: result.count, token: result.token, busy: result.busy })
    } catch (error) {
      setLifecycle("error", error instanceof Error ? error.message : String(error))
    } finally {
      setLifecycle("pending", false)
    }
  }
  const confirmLifecycle = async () => {
    if (!lifecycle.mode || lifecycle.pending || lifecycle.busy || !lifecycle.token) return
    setLifecycle({ pending: true, error: "" })
    try {
      const result = await platform.projectControls!.lifecycle({
        action: lifecycle.mode,
        directory: props.project.worktree,
        projectID: props.project.id,
        token: lifecycle.token,
        target: lifecycle.target || undefined,
      })
      const ctx = serverCtx()
      const metadata = { name: defaultName(), commands: props.project.commands }
      ctx.projects.forget(props.project.worktree)
      ctx.sync.project.forget(props.project.worktree)
      if (result.removedProjectID)
        ctx.sync.set("project", (items) => items.filter((item) => item.id !== result.removedProjectID))
      if (lifecycle.mode === "relocate") {
        ctx.projects.open(result.directory)
        ctx.sync.project.meta(result.directory, metadata)
        navigate(`/${base64Encode(result.directory)}/session`)
      } else navigate("/")
      dialog.close()
    } catch (error) {
      setLifecycle({ error: error instanceof Error ? error.message : String(error), token: "" })
    } finally {
      setLifecycle("pending", false)
    }
  }

  const save = useMutation(() => ({
    onError: (error: unknown) =>
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      }),
    mutationFn: async () => {
      await saveControls()
      const name = store.name.trim() === folderName() ? "" : store.name.trim()
      const start = store.startup.trim()

      if (props.project.id && props.project.id !== "global") {
        if ((await serverCtx().sdk.protocol) !== "v1") {
          dialog.close()
          return
        }
        const project = await serverCtx()
          .sdk.client.project.update({
            projectID: props.project.id,
            directory: props.project.worktree,
            name,
            commands: { start },
          })
          .then((result) => result.data)
        if (!project) return
        serverCtx().sync.set("project", (items) =>
          items.map((item) => (item.id === project.id ? normalizeProjectInfo(project) : item)),
        )
        dialog.close()
        return
      }

      serverCtx().sync.project.meta(props.project.worktree, {
        name,
        commands: { start: start || undefined },
      })
      dialog.close()
    },
  }))

  function submit(event: SubmitEvent) {
    event.preventDefault()
    if (save.isPending) return
    save.mutate()
  }

  return {
    store,
    lifecycle,
    lifecycleAvailable,
    prepareLifecycle,
    confirmLifecycle,
    cancelLifecycle() {
      if (!lifecycle.pending) setLifecycle({ mode: "", error: "", token: "" })
    },
    saveControls,
    sdk: () => serverCtx().sdk.ensureDirSdkContext(props.project.worktree),
    controlsAvailable,
    controls,
    setStore,
    folderName,
    save,
    submit,
    close() {
      dialog.close()
    },
  }
}
