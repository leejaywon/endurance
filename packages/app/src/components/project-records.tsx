import { createResource, For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { usePlatform } from "@/context/platform"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import type { createEditProjectModel } from "./edit-project"
import { ProjectEvaluations } from "./project-evaluations"

export function ProjectRecordsFields(props: {
  model: ReturnType<typeof createEditProjectModel>
  directory: string
  view?: "requests" | "evaluations"
}) {
  const language = useLanguage()
  const platform = usePlatform().projectControls!
  const [state, setState] = createStore({ requestsOpen: props.view === "requests" })
  const [requests, requestActions] = createResource(
    () => props.view === "requests" || (!props.view && state.requestsOpen),
    () => platform.requests(props.directory),
  )
  const remove = async (_kind: "requests", id: string) => {
    await platform.removeRecord(props.directory, "requests", id)
    await requestActions.refetch()
  }
  const failure = (error: unknown) =>
    showToast({
      title: language.t("common.requestFailed"),
      description: error instanceof Error ? error.message : String(error),
    })
  return (
    <>
      <Show when={props.view === "requests" && props.model.controls() && !props.model.controls.error}>
        <label class="flex items-center justify-between gap-3 mb-5">
          <span>{language.t("project.controls.retainRequests")}</span>
          <Switch
            aria-label={language.t("project.controls.retainRequests")}
            checked={props.model.store.controls.retainRequests}
            onChange={(value) => {
              void (async () => {
                const latest = await platform.read(props.directory)
                await platform.save(props.directory, { ...latest, retainRequests: value })
                props.model.setStore("controls", "retainRequests", value)
              })().catch(failure)
            }}
          />
        </label>
      </Show>
      <details
        open={props.view === "requests"}
        hidden={props.view === "evaluations"}
        class={props.view ? "" : "border-t border-border-weak-base pt-4"}
        onToggle={(event) => {
          setState("requestsOpen", event.currentTarget.open)
          if (event.currentTarget.open) void requestActions.refetch()
        }}
      >
        <summary class="cursor-pointer text-14-medium outline-none focus-visible:outline" hidden={!!props.view}>
          {language.t("project.records.requests")}
        </summary>
        <Show when={requests.error}>
          <p role="alert">{language.t("common.requestFailed")}</p>
        </Show>
        <For
          each={requests.error ? [] : (requests() ?? [])}
          fallback={<p class="mt-3 text-text-weak">{language.t("project.records.empty")}</p>}
        >
          {(record) => (
            <details class="mt-3">
              <summary class="cursor-pointer truncate outline-none focus-visible:outline">
                {record.model} · {new Date(record.time).toISOString()}
              </summary>
              <p class="mt-2 break-all text-text-weak">{record.origin}</p>
              <Show when={record.reason}>
                <p>{record.reason}</p>
              </Show>
              <pre class="my-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-12-regular">
                {record.content ?? language.t("project.records.contentsDisabled")}
              </pre>
              <ButtonV2
                type="button"
                variant="neutral"
                onClick={() => void remove("requests", record.id).catch(failure)}
              >
                {language.t("common.delete")}
              </ButtonV2>
            </details>
          )}
        </For>
      </details>
      <Show when={props.view !== "requests"}>
        <ProjectEvaluations model={props.model} directory={props.directory} />
      </Show>
    </>
  )
}
