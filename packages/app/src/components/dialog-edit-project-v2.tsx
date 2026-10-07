import { ProjectSourceFolders } from "./project-source-folders"
import { createStore } from "solid-js/store"
import { For, Show } from "solid-js"
import { ProjectRecordsFields } from "./project-records"
import { ProjectControlsFields } from "./project-controls"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode-ai/ui/v2/dialog-v2"
import { DividerV2 } from "@opencode-ai/ui/v2/divider-v2"
import { Field } from "@opencode-ai/ui/v2/field-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { useLanguage } from "@/context/language"
import { type LocalProject } from "@/context/layout"
import { ServerConnection } from "@/context/server"
import { createEditProjectModel } from "./edit-project"

export function DialogEditProjectV2(props: { project: LocalProject; server: ServerConnection.Any }) {
  const language = useLanguage()
  const model = createEditProjectModel(props)

  const labels = {
    general: "project.settings.general",
    access: "project.connections.title",
    instructions: "project.controls.memory",
    requests: "project.records.requests",
    evaluations: "project.records.evaluations",
  } as const
  const [state, setState] = createStore<{ section: keyof typeof labels }>({ section: "general" })
  const sections = (): (keyof typeof labels)[] =>
    model.controlsAvailable() ? ["general", "access", "instructions", "requests", "evaluations"] : ["general"]
  const label = (section: keyof typeof labels) => language.t(labels[section])
  const editing = () => !["requests", "evaluations"].includes(state.section)
  return (
    <Dialog
      fit
      containerClass="!w-[min(900px,calc(100vw-32px))] !max-h-[calc(100dvh-32px)]"
      class="!overflow-hidden [&_[data-slot=dialog-title]]:max-w-full"
    >
      <DialogHeader>
        <DialogTitleGroup
          title={
            <span class="flex min-w-0 items-center gap-2">
              <Icon name="settings-gear" size="normal" class="shrink-0" />
              <span class="sr-only">{language.t("project.settings.title")}: </span>
              <span class="truncate" title={props.project.name || model.folderName()}>
                {props.project.name || model.folderName()}
              </span>
            </span>
          }
          description={
            <span class="block break-all select-text text-12-regular text-text-weak">{props.project.worktree}</span>
          }
        />
      </DialogHeader>
      <DividerV2 />
      <DialogBody class="!flex-row !min-h-0 !flex-none h-[min(620px,calc(100dvh-190px))] max-sm:!flex-col">
        <nav
          aria-label={language.t("project.settings.title")}
          class="w-44 shrink-0 border-r border-border-weak-base p-3 flex flex-col gap-1 overflow-y-auto max-sm:w-full max-sm:flex-row max-sm:overflow-x-auto max-sm:border-r-0 max-sm:border-b"
        >
          <For each={sections()}>
            {(section) => (
              <ButtonV2
                type="button"
                variant={state.section === section ? "neutral" : "ghost-muted"}
                class="!justify-start !w-full max-sm:!w-auto shrink-0"
                aria-current={state.section === section ? "page" : undefined}
                disabled={!!model.lifecycle.mode}
                onClick={() => setState("section", section)}
              >
                {label(section)}
              </ButtonV2>
            )}
          </For>
        </nav>
        <div class="min-w-0 min-h-0 flex-1 overflow-y-auto p-6">
          <Show
            when={editing()}
            fallback={
              <ProjectRecordsFields
                model={model}
                directory={props.project.worktree}
                view={state.section === "requests" ? "requests" : "evaluations"}
              />
            }
          >
            <Show
              when={!model.lifecycle.mode}
              fallback={
                <div class="flex flex-col gap-4" aria-live="polite">
                  <h3 class="text-16-medium">
                    {language.t(model.lifecycle.mode === "delete" ? "project.delete.title" : "project.relocate.title", {
                      name: props.project.name || model.folderName(),
                    })}
                  </h3>
                  <Show when={model.lifecycle.token}>
                    <p>
                      {language.t(
                        model.lifecycle.mode === "delete"
                          ? "project.delete.description"
                          : "project.relocate.description",
                      )}
                    </p>
                    <p>{language.t("project.delete.conversations", { count: model.lifecycle.count })}</p>
                    <p class="text-text-weak">{language.t("project.delete.filesKept")}</p>
                    <Show when={model.lifecycle.mode === "relocate"}>
                      <p class="break-all select-text">{model.lifecycle.target}</p>
                    </Show>
                    <Show when={model.lifecycle.busy}>
                      <p role="alert">{language.t("project.delete.busy")}</p>
                    </Show>
                  </Show>
                  <Show when={model.lifecycle.pending}>
                    <p>{language.t("common.loading")}</p>
                  </Show>
                  <Show when={model.lifecycle.error || model.lifecycle.busy}>
                    <p role="alert" class="text-text-danger-base">
                      {model.lifecycle.error}
                    </p>
                    <ButtonV2
                      type="button"
                      variant="neutral"
                      onClick={() =>
                        void model.prepareLifecycle(
                          model.lifecycle.mode as "delete" | "relocate",
                          model.lifecycle.target,
                        )
                      }
                    >
                      {language.t("common.retry")}
                    </ButtonV2>
                  </Show>
                </div>
              }
            >
              <form id="project-settings-form" onSubmit={model.submit} class="flex flex-col gap-6">
                <Show when={state.section === "general"}>
                  <Field>
                    <Field.Label>{language.t("dialog.project.edit.name")}</Field.Label>
                    <TextInputV2
                      autofocus
                      appearance="large"
                      class="!w-full"
                      value={model.store.name}
                      placeholder={model.folderName()}
                      onInput={(event) => model.setStore("name", event.currentTarget.value)}
                    />
                  </Field>

                  <ProjectSourceFolders model={model} directory={props.project.worktree} />

                  <Field>
                    <Field.Label>{language.t("dialog.project.edit.worktree.startup")}</Field.Label>
                    <Field.Prefix>{language.t("dialog.project.edit.worktree.startup.description")}</Field.Prefix>
                    <TextareaV2
                      class="!w-full [&_[data-slot=textarea-v2-textarea]]:font-mono"
                      rows={3}
                      value={model.store.startup}
                      placeholder={language.t("dialog.project.edit.worktree.startup.placeholder")}
                      spellcheck={false}
                      onInput={(event) => model.setStore("startup", event.currentTarget.value)}
                    />
                  </Field>
                  <Show when={model.lifecycleAvailable()}>
                    <section class="border-t border-border-weak-base pt-6 flex flex-col items-start gap-3">
                      <p class="text-12-regular text-text-weak">{language.t("project.delete.summary")}</p>
                      <ButtonV2 type="button" variant="danger" onClick={() => void model.prepareLifecycle("delete")}>
                        {language.t("project.delete.action")}
                      </ButtonV2>
                    </section>
                  </Show>
                </Show>
                <Show when={state.section !== "general"}>
                  <ProjectControlsFields
                    model={model}
                    directory={props.project.worktree}
                    section={state.section === "instructions" ? "instructions" : "access"}
                  />
                </Show>
              </form>
            </Show>
          </Show>
        </div>
      </DialogBody>
      <DialogFooter>
        <Show
          when={!model.lifecycle.mode}
          fallback={
            <>
              <ButtonV2
                type="button"
                variant="neutral"
                disabled={model.lifecycle.pending}
                onClick={model.cancelLifecycle}
              >
                {language.t("common.cancel")}
              </ButtonV2>
              <ButtonV2
                type="button"
                variant={model.lifecycle.mode === "delete" ? "danger" : "contrast"}
                disabled={model.lifecycle.pending || model.lifecycle.busy || !model.lifecycle.token}
                onClick={() => void model.confirmLifecycle()}
              >
                {language.t(model.lifecycle.mode === "delete" ? "common.delete" : "project.relocate.confirm")}
              </ButtonV2>
            </>
          }
        >
          <ButtonV2 type="button" variant="neutral" disabled={model.save.isPending} onClick={model.close}>
            {language.t(editing() ? "common.cancel" : "common.close")}
          </ButtonV2>
          <Show when={editing()}>
            <ButtonV2 type="submit" form="project-settings-form" variant="contrast" disabled={model.save.isPending}>
              {model.save.isPending ? language.t("common.saving") : language.t("common.save")}
            </ButtonV2>
          </Show>
        </Show>
      </DialogFooter>
    </Dialog>
  )
}
