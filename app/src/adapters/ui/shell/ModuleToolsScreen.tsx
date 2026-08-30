import { Navigate, useParams } from 'react-router-dom'
import { kModuleTaxonomy } from './moduleTaxonomy'
import { ModuleSectionView } from './ModuleSectionView'

/**
 * Page 2 — a single selected module's tools, sidebar still visible around it
 * (this is only the content pane). Matches the DevToys-style reference: pick
 * a category in the rail, the main pane narrows to just that category.
 */
export function ModuleToolsScreen() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const module = kModuleTaxonomy.find((m) => m.id === moduleId)

  if (!module) {
    return <p className="p-7 text-muted-foreground">Unknown module "{moduleId}"</p>
  }

  // Single-tool shell modules have nothing useful to show here — send straight
  // to the tool (same reason the rail skips this page for them).
  if (module.hideToolPane && module.tools[0]?.route) {
    return <Navigate to={module.tools[0].route} replace />
  }

  return (
    <div className="p-7">
      <ModuleSectionView module={module} linkHeaderToModulePage={false} />
    </div>
  )
}
