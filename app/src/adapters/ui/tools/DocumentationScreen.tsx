import { EXTERNAL_RESOURCE_LINKS, type ResourceType } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

const TYPE: ResourceType = 'documentation'

/**
 * Official project documentation (Zabbix, Ceph, PostgreSQL, Kubernetes,
 * Linux Kernel, ...) — kept separate from curated "awesome-X" lists
 * (ReferenceListsScreen) and from cheatsheets (CheatsheetsScreen), since
 * those are different kinds of thing even though an earlier version crammed
 * all three into one screen. See design.md.
 */
export function DocumentationScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === TYPE)

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Documentation</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Official documentation for the systems this app targets — the authoritative source, not a third-party summary."
          links={links}
        />
      </div>
    </div>
  )
}
