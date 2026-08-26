import { useMemo, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { DockerRunConverter } from '@/core/config/dockerRunConverter'

const converter = new DockerRunConverter()

const EXAMPLE_COMMAND =
  'docker run -d --name web -p 8080:80 \\\n' +
  '  -e "APP_ENV=production" \\\n' +
  '  -v webdata:/var/lib/data \\\n' +
  '  --restart unless-stopped \\\n' +
  '  nginx:1.25'

export function DockerRunConverterScreen() {
  const [command, setCommand] = useState('')

  const result = useMemo(() => {
    try {
      return { value: converter.execute({ command }), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [command])

  const yaml = result.value?.isValid ? result.value.yaml : undefined

  return (
    <ToolDetailScaffold
      title="Docker Run → Compose Converter"
      copyText={yaml}
      inputPanel={
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">docker run command</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setCommand(EXAMPLE_COMMAND)}>
              <Wand2 className="size-3.5" /> Load example
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Paste a docker run command exactly as written — multi-line with trailing backslashes is fine. Quoting is
            honoured, so -e "FOO=bar baz" survives as one value.
          </p>
          <Textarea
            className="min-h-64 font-mono text-xs"
            placeholder={EXAMPLE_COMMAND}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
          />
          {result.error ? (
            <Alert variant="destructive">
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      }
      outputPanel={
        command.trim().length === 0 && !result.value ? (
          <p className="text-sm text-muted-foreground">
            Paste a docker run command on the left to generate docker-compose.yml.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {!result.value || !result.value.isValid ? (
              <Alert variant="destructive">
                <AlertDescription>{result.value?.errorMessage ?? 'Paste a docker run command to convert.'}</AlertDescription>
              </Alert>
            ) : (
              <pre className="max-w-full overflow-x-auto whitespace-pre rounded-lg border border-border/60 bg-background p-4 font-mono text-xs">
                {result.value.yaml}
              </pre>
            )}

            {result.value && result.value.warnings.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-destructive">
                  Unsupported / ignored flags ({result.value.warnings.length})
                </p>
                <p className="text-xs text-muted-foreground">
                  These flags were recognised but not translated. Review them before relying on the generated file.
                </p>
                {result.value.warnings.map((warning, i) => (
                  <Alert key={i} variant="destructive">
                    <AlertDescription>{warning}</AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : null}

            {result.value && result.value.notes.length > 0 ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">Notes</p>
                {result.value.notes.map((note, i) => (
                  <Alert key={i}>
                    <AlertDescription>{note}</AlertDescription>
                  </Alert>
                ))}
              </div>
            ) : null}
          </div>
        )
      }
    />
  )
}
