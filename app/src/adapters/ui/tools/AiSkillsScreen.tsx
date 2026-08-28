import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'aiSkill'

/**
 * Agent-skill ecosystems — SKILL.md packages, skill marketplaces and
 * directories. Knowledge Hub "AI & Automation" group.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function AiSkillsScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">AI Skills</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Packaged agent skills (SKILL.md) and the marketplaces / directories that index them."
          links={links}
        />
      </div>
    </div>
  )
}
