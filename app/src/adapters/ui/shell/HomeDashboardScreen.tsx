import { useModuleVisibilityStore, visibleModulesInOrder } from '@/stores/moduleVisibilityStore'
import { ModuleSectionView } from './ModuleSectionView'

/**
 * Page 1 — "All Tools": every visible module's name + its tools, for
 * browsing and picking one to drill into. Purely derived from
 * kModuleTaxonomy + useModuleVisibilityStore, so a new module/tool or a
 * reorder/hide choice needs zero changes here.
 */
export function HomeDashboardScreen() {
  const { order, hiddenIds } = useModuleVisibilityStore()
  const modules = visibleModulesInOrder(order, hiddenIds)

  return (
    <div className="p-7">
      {modules.map((module) => (
        <ModuleSectionView key={module.id} module={module} />
      ))}
    </div>
  )
}
