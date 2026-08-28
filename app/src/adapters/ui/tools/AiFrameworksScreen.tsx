import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'aiFramework'

/**
 * Agent and AI-dev frameworks / SDKs — the libraries you build agents and
 * LLM apps on (LangChain, ADK, Pydantic AI, CrewAI, vLLM, …). Knowledge Hub
 * "AI & Automation" group. See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function AiFrameworksScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">AI Frameworks &amp; SDKs</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Frameworks and SDKs for building agents and LLM applications — the code you depend on, not an end-user product."
          links={links}
        />
      </div>
    </div>
  )
}
