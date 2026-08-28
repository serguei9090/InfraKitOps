import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'mcpServer'

/**
 * Model Context Protocol servers, gateways, and registries — part of the
 * Knowledge Hub's "AI & Automation" group. Card links to each project's main
 * site. See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function McpServersScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">MCP Servers</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="MCP servers, gateways, and registries — the tool layer agents connect to. Registry/directory entries are tagged as such."
          links={links}
        />
      </div>
    </div>
  )
}
