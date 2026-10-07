import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { createResource, For, Show } from "solid-js"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { TextareaV2 } from "@opencode-ai/ui/v2/textarea-v2"
import { useLanguage } from "@/context/language"
import { useProviders } from "@/hooks/use-providers"
import { useVoice } from "@/context/voice"
import type { createEditProjectModel } from "./edit-project"

export function ProjectControlsFields(props: {
  model: ReturnType<typeof createEditProjectModel>
  directory: string
  section: "access" | "instructions"
}) {
  const language = useLanguage()
  const providers = useProviders(() => props.directory)
  const voice = useVoice()
  const [tools] = createResource(
    () => props.model.controlsAvailable(),
    async () => (await props.model.sdk().client.mcp.status()).data ?? {},
  )
  const controls = () => props.model.store.controls
  const toolNames = () => [
    ...new Set([...Object.keys(tools.error ? {} : (tools() ?? {})), ...(controls().connections ?? [])]),
  ]
  const connections = () =>
    Array.from(
      new Map([
        ...(controls().providers ?? []).map((id) => [id, id] as const),
        ...Object.keys(controls().origins).map((id) => [id, id] as const),
        ...providers.connected().map((item) => [item.id, item.name] as const),
        ...voice.models().map((item) => [item.providerID, item.providerName ?? item.name] as const),
      ]).entries(),
    )
  function update<K extends keyof ReturnType<typeof controls>>(key: K, value: ReturnType<typeof controls>[K]) {
    props.model.setStore("controls", { ...controls(), [key]: value })
    props.model.setStore("controlsDirty", true)
  }
  const restricted = () =>
    controls().isolate ||
    controls().excluded.length > 0 ||
    controls().readOnly.length > 0 ||
    controls().sourceFolders.length > 0
  return (
    <Show when={props.model.controlsAvailable()}>
      <Show when={props.model.controls.error}>
        <p role="alert">{language.t("project.controls.loadError")}</p>
      </Show>
      <Show when={!props.model.controls.error && props.model.controls()}>
        <Show
          when={props.section === "instructions"}
          fallback={
            <div class="flex flex-col gap-7">
              <section class="flex flex-col gap-4">
                <label class="flex items-center justify-between gap-4">
                  <span class="text-14-medium">{language.t("project.connections.external")}</span>
                  <Switch
                    aria-label={language.t("project.connections.external")}
                    checked={!controls().isolate && controls().deviceOnly.length === 0}
                    disabled={controls().isolate}
                    onChange={(value) => update("deviceOnly", value ? [] : ["."])}
                  />
                </label>
                <p class="text-12-regular text-text-weak">{language.t("project.connections.externalHint")}</p>
              </section>
              <section class="flex flex-col gap-3 border-t border-border-weak-base pt-5">
                <h3 class="text-14-medium">{language.t("project.settings.models")}</h3>
                <Show
                  when={connections().length}
                  fallback={<p class="text-12-regular text-text-weak">{language.t("project.connections.empty")}</p>}
                >
                  <For each={connections()}>
                    {([id, name]) => (
                      <div class="flex items-center justify-between gap-3 py-1">
                        <span class="min-w-0 break-words">{name}</span>
                        <Show when={connections().length > 1 || controls().providers !== null}>
                          <Switch
                            aria-label={name}
                            checked={controls().providers === null || controls().providers!.includes(id)}
                            onChange={(enabled) =>
                              update(
                                "providers",
                                enabled
                                  ? [...new Set([...(controls().providers ?? connections().map(([id]) => id)), id])]
                                  : (controls().providers ?? connections().map(([id]) => id)).filter(
                                      (entry) => entry !== id,
                                    ),
                              )
                            }
                          />
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              </section>
              <section class="flex flex-col gap-3 border-t border-border-weak-base pt-5">
                <h3 class="text-14-medium">{language.t("project.settings.connections")}</h3>
                <Show when={tools.error}>
                  <p role="alert">{language.t("common.requestFailed")}</p>
                </Show>
                <Show when={restricted()}>
                  <p class="text-12-regular text-text-weak">{language.t("project.connections.restricted")}</p>
                </Show>
                <Show when={!toolNames().length && !tools.error}>
                  <p class="text-12-regular text-text-weak">{language.t("project.connections.noTools")}</p>
                </Show>
                <For each={toolNames()}>
                  {(name) => (
                    <label class="flex items-center justify-between gap-3 py-1">
                      <span class="break-all">{name}</span>
                      <Switch
                        aria-label={name}
                        disabled={!!restricted()}
                        checked={
                          !restricted() &&
                          controls().networkTools &&
                          (controls().connections === null || controls().connections!.includes(name))
                        }
                        onChange={(enabled) => {
                          const existing = controls().networkTools ? (controls().connections ?? toolNames()) : []
                          update(
                            "connections",
                            enabled ? [...new Set([...existing, name])] : existing.filter((entry) => entry !== name),
                          )
                          if (enabled) update("networkTools", true)
                        }}
                      />
                    </label>
                  )}
                </For>
              </section>
              <details class="border-t border-border-weak-base pt-5">
                <summary class="cursor-pointer text-12-regular text-text-weak">
                  {language.t("project.connections.advanced")}
                </summary>
                <div class="flex flex-col gap-5 pt-4">
                  <label class="flex items-center justify-between gap-4">
                    <span>{language.t("project.controls.concurrency")}</span>
                    <SelectV2
                      options={[1, 2, 3, 4, 5, 6, 7, 8]}
                      current={controls().localConcurrency}
                      value={String}
                      label={String}
                      onSelect={(value) => value && update("localConcurrency", value)}
                    />
                  </label>
                  <For each={connections()}>
                    {([id, name]) => (
                      <label class="flex flex-col gap-2 text-12-regular">
                        {name} · {language.t("project.settings.addresses")}
                        <TextInputV2
                          class="!w-full"
                          value={controls().origins[id]?.join(", ") ?? ""}
                          placeholder="https://api.example.com"
                          onInput={(event) => {
                            const values = event.currentTarget.value
                              .split(",")
                              .map((v) => v.trim())
                              .filter(Boolean)
                            const origins = { ...controls().origins }
                            if (values.length) origins[id] = values
                            else delete origins[id]
                            update("origins", origins)
                          }}
                        />
                      </label>
                    )}
                  </For>
                  <Show when={!controls().commands}>
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-12-regular">{language.t("project.connections.commandsDisabled")}</span>
                      <ButtonV2 type="button" variant="neutral" onClick={() => update("commands", true)}>
                        {language.t("project.connections.restore")}
                      </ButtonV2>
                    </div>
                  </Show>
                  <Show when={controls().isolate}>
                    <div class="flex flex-col gap-2">
                      <span class="text-12-regular">{language.t("project.connections.legacyIsolation")}</span>
                      <ButtonV2
                        type="button"
                        variant="neutral"
                        onClick={() => {
                          update("deviceOnly", ["."])
                          update("isolate", false)
                        }}
                      >
                        {language.t("project.connections.fileRules")}
                      </ButtonV2>
                    </div>
                  </Show>
                </div>
              </details>
            </div>
          }
        >
          <label class="flex flex-col gap-3">
            <span class="text-14-medium">{language.t("project.controls.memory")}</span>
            <TextareaV2
              class="!w-full"
              rows={12}
              aria-label={language.t("project.controls.memory")}
              value={controls().memory}
              onInput={(event) => update("memory", event.currentTarget.value)}
            />
          </label>
        </Show>
      </Show>
    </Show>
  )
}
