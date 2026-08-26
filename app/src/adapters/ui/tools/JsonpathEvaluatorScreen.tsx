import { useMemo, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  JsonPathEvaluator,
  jsonPathPrettyValue,
  jsonPathPrettyValues,
  type JsonPathResult,
} from '@/core/utility/jsonpathEvaluator'

const evaluator = new JsonPathEvaluator()

export function JsonpathEvaluatorScreen() {
  const [document, setDocument] = useState('')
  const [expression, setExpression] = useState('$')

  const result: JsonPathResult = useMemo(() => {
    try {
      return evaluator.execute({ document, expression })
    } catch (e) {
      return { isValid: false, errorMessage: e instanceof Error ? e.message : String(e), matches: [] }
    }
  }, [document, expression])

  const copyText = result.isValid ? jsonPathPrettyValues(result) : undefined

  return (
    <ToolDetailScaffold
      title="JSONPath Evaluator"
      copyText={copyText}
      inputPanel={
        <div className="flex max-w-xl flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jsonpath-document">JSON document</Label>
            <Textarea
              id="jsonpath-document"
              rows={16}
              className="font-mono text-sm"
              placeholder="Paste a JSON document here"
              value={document}
              onChange={(e) => setDocument(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="jsonpath-expression">JSONPath expression</Label>
            <Input
              id="jsonpath-expression"
              className="font-mono text-sm"
              placeholder="e.g. $.store.book[?(@.price < 10)].title"
              value={expression}
              onChange={(e) => setExpression(e.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Supports $, .name, ['name'], wildcards * and [*], indexes including negative, slices
            [start:end:step], recursive descent .., and simple filters [?(@.x == 1)].
          </p>
        </div>
      }
      outputPanel={
        !result.isValid ? (
          <div className="flex items-start gap-2">
            <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">
              {result.errorMessage ?? 'Enter a document and an expression to see results.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600 dark:text-green-400" />
              <p className="text-sm font-medium">
                {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
              </p>
            </div>
            {result.matches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matches.</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {result.matches.map((match, index) => (
                  <div key={`${match.path}-${index}`} className="rounded-lg border border-border p-3">
                    <p className="font-mono text-xs font-semibold text-primary">
                      [{index}] {match.path}
                    </p>
                    <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted/60 p-2.5 font-mono text-xs">
                      {jsonPathPrettyValue(match)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }
    />
  )
}
