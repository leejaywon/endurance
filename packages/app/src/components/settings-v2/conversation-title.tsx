import { createMemo, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { SelectV2 } from "@opencode-ai/ui/v2/select-v2"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { useLanguage } from "@/context/language"
import { useModels, type ModelKey } from "@/context/models"
import { useServerSync } from "@/context/server-sync"
import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"
import { ModelSelectorPopoverV2 } from "../dialog-select-model"
import { SettingsRowV2 } from "./parts/row"

export function ConversationTitleSetting() {
  const language = useLanguage()
  const sync = useServerSync()
  const models = useModels()
  const [store, setStore] = createStore({ busy: false, choosing: false })
  const enabled = () => sync().data.config.agent?.title?.disable === false
  const configured = () => sync().data.config.agent?.title?.model ?? ""
  const selection = createMemo(() => {
    const separator = configured().indexOf("/")
    if (separator < 1) return undefined
    return { providerID: configured().slice(0, separator), modelID: configured().slice(separator + 1) }
  })
  const selected = createMemo(() => {
    const key = selection()
    return key && models.list().find((model) => model.provider.id === key.providerID && model.id === key.modelID)
  })
  const custom = () => store.choosing || !!configured()
  const save = async (title: { disable?: boolean; model?: string }) => {
    if (store.busy) return
    setStore("busy", true)
    await sync()
      .updateConfig({ agent: { title } })
      .catch((error) =>
        showToast({ title: language.t("common.requestFailed"), description: formatServerError(error, language.t) }),
      )
      .finally(() => setStore("busy", false))
  }
  const selectModel = (key: ModelKey) => {
    void save({ model: `${key.providerID}/${key.modelID}` })
  }

  return (
    <>
      <SettingsRowV2
        title={language.t("settings.general.row.conversationTitle.title")}
        description={language.t("settings.general.row.conversationTitle.description")}
      >
        <SelectV2
          appearance="inline"
          data-action="settings-conversation-title"
          options={["message", "ai"]}
          current={enabled() ? "ai" : "message"}
          disabled={store.busy}
          placement="bottom-end"
          label={(option) =>
            language.t(option === "ai" ? "settings.general.title.ai" : "settings.general.title.message")
          }
          onSelect={(option) => option && void save({ disable: option !== "ai" })}
        />
      </SettingsRowV2>
      <Show when={enabled()}>
        <SettingsRowV2
          title={language.t("settings.general.row.titleModel.title")}
          description={language.t("settings.general.row.titleModel.description")}
        >
          <SelectV2
            appearance="inline"
            data-action="settings-title-model-source"
            options={["current", "custom"]}
            current={custom() ? "custom" : "current"}
            disabled={store.busy}
            placement="bottom-end"
            label={(option) =>
              language.t(
                option === "custom" ? "settings.general.title.customModel" : "settings.general.title.currentModel",
              )
            }
            onSelect={(option) => {
              if (!option) return
              setStore("choosing", option === "custom")
              if (option === "current") void save({ model: "" })
            }}
          />
        </SettingsRowV2>
        <Show when={custom()}>
          <SettingsRowV2
            title={language.t("settings.general.row.titleCustomModel.title")}
            description={language.t(
              configured() && !selected()
                ? "settings.general.title.unavailable"
                : "settings.general.row.titleCustomModel.description",
            )}
          >
            <ModelSelectorPopoverV2
              selection={selection()}
              onSelectModel={selectModel}
              trigger={(props) => (
                <ButtonV2
                  {...props}
                  variant="ghost"
                  data-action="settings-title-model"
                  disabled={store.busy}
                  class="max-w-[320px]"
                >
                  <span class="truncate">
                    {selected()
                      ? `${selected()!.provider.name} / ${selected()!.name}`
                      : configured() || language.t("settings.general.title.chooseModel")}
                  </span>
                  <Icon name="chevron-down" size="small" />
                </ButtonV2>
              )}
            />
          </SettingsRowV2>
        </Show>
      </Show>
    </>
  )
}
