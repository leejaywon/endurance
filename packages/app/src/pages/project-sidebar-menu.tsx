import { For } from "solid-js"
import { createStore } from "solid-js/store"
import { Icon } from "@opencode-ai/ui/v2/icon"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { useLanguage } from "@/context/language"
import type { ProjectSidebarGroup, ProjectSidebarSort } from "./project-sidebar-order"

export function ProjectSidebarMenu(props: {
  group: ProjectSidebarGroup
  sort: ProjectSidebarSort
  onGroupChange: (value: ProjectSidebarGroup) => void
  onSortChange: (value: ProjectSidebarSort) => void
}) {
  const language = useLanguage()
  const [state, setState] = createStore({ open: false })
  const groups = ["date", "folder"] as const
  const sorts = ["name", "created", "activity"] as const
  return (
    <MenuV2 placement="bottom-end" gutter={4} open={state.open} onOpenChange={(open) => setState("open", open)}>
      <TooltipV2 placement="bottom" value={language.t("sidebar.projects.organize")}>
        <MenuV2.Trigger
          as={IconButtonV2}
          data-action="project-sidebar-organize"
          variant="ghost-muted"
          size="large"
          class="titlebar-icon [&_[data-slot=icon-svg]]:text-v2-icon-icon-muted"
          icon={<Icon name="arrows-sort" />}
          aria-label={language.t("sidebar.projects.organize")}
        />
      </TooltipV2>
      <MenuV2.Portal>
        <MenuV2.Content class="w-[240px]">
          <MenuV2.Sub gutter={4}>
            <MenuV2.SubTrigger>
              <span class="flex-1">{language.t("sidebar.projects.groupBy")}</span>
              <span class="text-v2-text-text-faint">{language.t(`sidebar.projects.group.${props.group}`)}</span>
            </MenuV2.SubTrigger>
            <MenuV2.Portal>
              <MenuV2.SubContent>
                <MenuV2.RadioGroup
                  value={props.group}
                  onChange={(value) => {
                    const group = groups.find((group) => group === value)
                    if (group) props.onGroupChange(group)
                  }}
                >
                  <For each={groups}>
                    {(group) => (
                      <MenuV2.RadioItem value={group} onSelect={() => setState("open", false)}>
                        {language.t(`sidebar.projects.group.${group}`)}
                      </MenuV2.RadioItem>
                    )}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.SubContent>
            </MenuV2.Portal>
          </MenuV2.Sub>
          <MenuV2.Sub gutter={4}>
            <MenuV2.SubTrigger>
              <span class="flex-1">{language.t("sidebar.projects.sortBy")}</span>
              <span class="text-v2-text-text-faint">{language.t(`sidebar.projects.sort.${props.sort}`)}</span>
            </MenuV2.SubTrigger>
            <MenuV2.Portal>
              <MenuV2.SubContent>
                <MenuV2.RadioGroup
                  value={props.sort}
                  onChange={(value) => {
                    const sort = sorts.find((sort) => sort === value)
                    if (sort) props.onSortChange(sort)
                  }}
                >
                  <For each={sorts}>
                    {(sort) => (
                      <MenuV2.RadioItem value={sort} onSelect={() => setState("open", false)}>
                        {language.t(`sidebar.projects.sort.${sort}`)}
                      </MenuV2.RadioItem>
                    )}
                  </For>
                </MenuV2.RadioGroup>
              </MenuV2.SubContent>
            </MenuV2.Portal>
          </MenuV2.Sub>
        </MenuV2.Content>
      </MenuV2.Portal>
    </MenuV2>
  )
}
