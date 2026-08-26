import { EXTERNAL_RESOURCE_LINKS } from '@/core/cheatsheets/cheatsheetContent'
import { ResourceLinkListView } from './ResourceLinkListView'

/**
 * Hands-on learning material — exercises/practice repos and roadmaps —
 * things you work *through* to build a skill, distinct from reference
 * material you just browse or look up (DocumentationScreen,
 * ReferenceListsScreen). See design.md. Groups results by resource type
 * since this screen (unlike the other two) covers more than one
 * ResourceType.
 */
export function StudyPracticeScreen() {
  const links = EXTERNAL_RESOURCE_LINKS.filter((l) => l.type === 'exercise' || l.type === 'roadmap')

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-5">
        <h1 className="text-[17px] font-semibold tracking-tight">Study & Practice</h1>
      </div>
      <div className="flex-1 overflow-auto p-5">
        <ResourceLinkListView
          description="Exercises, practice repos, and roadmaps — material meant to be worked through, not just referenced."
          links={links}
          groupByType
        />
      </div>
    </div>
  )
}
