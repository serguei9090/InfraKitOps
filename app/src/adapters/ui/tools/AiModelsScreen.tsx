import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'aiModel'

/**
 * Foundation models plus their official tooling / harnesses, and the
 * cross-model serving stacks (Ollama, vLLM, llama.cpp, …). Static links only —
 * no runtime leaderboard fetch, the Hub stays offline.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md §6.
 */
export function AiModelsScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">AI Models &amp; Harnesses</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Major foundation model families and their vendor docs / SDKs, plus the serving and inference harnesses. Filter by vendor or 'harness'."
          links={links}
        />
      </div>
    </div>
  )
}
