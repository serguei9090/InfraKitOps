import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'devService'

/**
 * Hosted infra products — tunnels, static hosts, PaaS and deploy platforms
 * (ngrok, Netlify, Cloudflare Tunnel, Fly.io, …). Knowledge Hub
 * "AI & Automation" group. Card links to each product's main site.
 * See KNOWLEDGE_HUB_AI_EXPANSION_PLAN.md.
 */
export function DevServicesScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Dev Services &amp; Hosting</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Tunnels, static hosting, PaaS and deploy platforms — hosted services for shipping and exposing dev work. Filter by tag (tunnel, paas, free-tier, …)."
          links={links}
        />
      </div>
    </div>
  )
}
