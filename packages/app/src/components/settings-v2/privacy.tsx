import { createResource, createSignal, For, Show } from "solid-js"
import { PrivacyDefaults } from "@opencode-ai/core/project-controls/schema"
import { Icon } from "@opencode-ai/ui/v2/icon"
import "./privacy.css"
import { Switch } from "@opencode-ai/ui/v2/switch-v2"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { useLayout } from "@/context/layout"
import { useServerSync } from "@/context/server-sync"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"

export function SettingsPrivacy() {
  const platform = usePlatform()
  const language = useLanguage()
  const layout = useLayout()
  const server = useServer()
  const serverSync = useServerSync()
  const [saving, setSaving] = createSignal(false)
  const [settings, { mutate }] = createResource(async () => {
    if (!platform.projectControls?.defaults) throw new Error(language.t("settings.privacy.restart"))
    return PrivacyDefaults.parse(await platform.projectControls.defaults())
  })
  const label = (access: string) =>
    language.t(
      access === "write" ? "project.files.write" : access === "read" ? "project.files.read" : "project.files.none",
    )
  async function update(patch: Partial<PrivacyDefaults>) {
    if (saving() || settings.error || !settings()) return
    setSaving(true)
    try {
      // Snapshot known projects with the previous defaults before changing them.
      const directories = new Set([
        ...layout.projects.list().map((project) => project.worktree),
        ...serverSync()
          .data.project.filter((project) => project.id !== "global")
          .map((project) => project.worktree),
      ])
      if (server.current?.type === "sidecar" && server.current.variant === "base")
        await Promise.all([...directories].map((directory) => platform.projectControls!.read(directory)))
      const next = PrivacyDefaults.parse({ ...settings(), ...patch })
      await platform.projectControls!.saveDefaults(next)
      mutate(next)
    } catch (error) {
      showToast({
        title: language.t("common.requestFailed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <div class="settings-v2-panel">
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.privacy.title")}</h2>
      </div>
      <div class="settings-v2-tab-body privacy-settings">
        <Show when={settings.error}>
          <p role="alert">{String(settings.error?.message ?? language.t("common.requestFailed"))}</p>
        </Show>
        <Show when={!settings.error && settings()}>
          {(value) => (
            <>
              <section class="privacy-section" aria-labelledby="privacy-access-heading">
                <h3 id="privacy-access-heading" class="text-14-medium">
                  {language.t("settings.privacy.access")}
                </h3>
                <div class="privacy-access-rows">
                  <For each={["project", "folder"] as const}>
                    {(field) => (
                      <div class="privacy-access-row">
                        <span id={`privacy-${field}-label`}>
                          {language.t(field === "project" ? "settings.privacy.project" : "settings.privacy.folder")}
                        </span>
                        <div
                          class="privacy-access-options"
                          role="group"
                          aria-labelledby={`privacy-${field}-label`}
                          aria-busy={saving()}
                        >
                          <For each={["write", "read", "none"] as const}>
                            {(access) => (
                              <button
                                type="button"
                                class="privacy-access-option"
                                data-access={access}
                                aria-pressed={value()[field] === access}
                                disabled={saving()}
                                onClick={() => value()[field] !== access && void update({ [field]: access })}
                              >
                                <Icon
                                  name={
                                    access === "write" ? "pencil-line" : access === "read" ? "eye" : "circle-ban-sign"
                                  }
                                  size="small"
                                />
                                {label(access)}
                              </button>
                            )}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
                <p class="privacy-description">{language.t("settings.privacy.description")}</p>
              </section>
              <section class="privacy-section" aria-labelledby="privacy-models-heading">
                <h3 id="privacy-models-heading" class="text-14-medium">
                  {language.t("settings.privacy.models")}
                </h3>
                <div class="privacy-model-row">
                  <div class="privacy-model-copy">
                    <span>{language.t("settings.privacy.external")}</span>
                    <p id="privacy-external-description" class="privacy-description">
                      {language.t("settings.privacy.externalDescription")}
                    </p>
                  </div>
                  <Switch
                    disabled={saving()}
                    aria-label={language.t("settings.privacy.external")}
                    aria-describedby="privacy-external-description"
                    checked={value().externalProcessing}
                    onChange={(v) => void update({ externalProcessing: v })}
                  />
                </div>
              </section>
            </>
          )}
        </Show>
      </div>
    </div>
  )
}
