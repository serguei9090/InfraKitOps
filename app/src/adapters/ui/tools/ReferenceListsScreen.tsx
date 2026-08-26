import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'curatedList'

/**
 * Curated "awesome-X" style reference lists — collections of links compiled
 * by the community, distinct from official documentation (a single
 * authoritative source, DocumentationScreen) and from cheatsheets (a quick
 * lookup this app generates itself, CheatsheetsScreen). See design.md.
 */
export function ReferenceListsScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Reference Lists</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description='Curated, community-maintained collections of links — a starting point to browse from, not a single authoritative doc.'
          links={links}
        />
      </div>
    </div>
  )
}
