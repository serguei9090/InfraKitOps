import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { libraryExport, libraryImport } from '@/adapters/backend/runbookClient'
import { useRunbookStore } from '@/stores/runbookStore'

const DIR_KEY = 'infrakit:runbook-sync-dir'

/** Export the whole library to `<slug>.runbook.json` files in a folder, and
 *  import them back. When the folder is a git repo, optionally commit + push.
 *  Secrets are never in these files. See RUNBOOK_MODULE_PLAN.md §5.1. */
export function LibrarySyncDialog() {
  const refresh = useRunbookStore((s) => s.refresh)
  const [dir, setDir] = useState(() => {
    try {
      return localStorage.getItem(DIR_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [gitCommit, setGitCommit] = useState(false)
  const [gitPush, setGitPush] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<string | null>(null)

  function remember(d: string) {
    setDir(d)
    try {
      localStorage.setItem(DIR_KEY, d)
    } catch {
      /* ignore */
    }
  }

  async function doExport() {
    setBusy(true)
    setReport(null)
    try {
      const r = await libraryExport({ dir, gitCommit, gitPush })
      setReport(r.report)
    } catch (e) {
      setReport(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  async function doImport() {
    setBusy(true)
    setReport(null)
    try {
      const r = await libraryImport(dir)
      setReport(`imported ${r.imported} runbook(s)`)
      await refresh()
    } catch (e) {
      setReport(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm">
            <GitBranch className="size-4" /> Sync
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Library sync</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="sync-dir">Folder (git repo optional)</Label>
            <Input
              id="sync-dir"
              value={dir}
              onChange={(e) => remember(e.target.value)}
              placeholder="C:\\ops\\runbooks  or  /home/me/runbooks"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              One <span className="font-mono">&lt;slug&gt;.runbook.json</span> per runbook. Secrets are never
              written here.
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={gitCommit} onChange={(e) => setGitCommit(e.target.checked)} className="size-3 accent-primary" />
              git commit
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={gitPush}
                disabled={!gitCommit}
                onChange={(e) => setGitPush(e.target.checked)}
                className="size-3 accent-primary"
              />
              &amp; push
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" disabled={!dir || busy} onClick={() => void doExport()}>
              Export
            </Button>
            <Button size="sm" variant="outline" className="flex-1" disabled={!dir || busy} onClick={() => void doImport()}>
              Import
            </Button>
          </div>
          {report && (
            <pre className="max-h-40 overflow-auto rounded-md border border-border/60 bg-background p-2 text-[11px]">
              {report}
            </pre>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline">Close</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
