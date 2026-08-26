import { Plus, Save, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Controller, useFieldArray, useForm, useWatch, type Control } from 'react-hook-form'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import { createSchemaRepository } from '@/adapters/storage/schemaRepository'
import { FormFlowParser } from '@/core/form_flow/formFlowParser'
import {
  FIELD_TYPE_LABELS,
  defaultValuesFromFields,
  fieldDisplayLabel,
  type FieldType,
  type FormFlowSchema,
  type SavedFormFlowTemplate,
  type SchemaField,
  type SourceFormat,
} from '@/core/form_flow/schemaModel'

const parser = new FormFlowParser()
const repository = createSchemaRepository()

const FIELD_TYPES: FieldType[] = ['text', 'number', 'boolean', 'object', 'array']
const SOURCE_FORMATS: SourceFormat[] = ['xml', 'yaml', 'json']

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Reclassifies `field` to `newType`. object<->array keep their children
 * (same shape: a list of named sub-fields). Any other transition drops
 * children and keeps whatever defaultValue it already had.
 */
function retypeField(field: SchemaField, newType: FieldType): SchemaField {
  const wasContainer = field.type === 'object' || field.type === 'array'
  const becomesContainer = newType === 'object' || newType === 'array'
  if (wasContainer && becomesContainer) return { ...field, type: newType }
  if (becomesContainer) return { ...field, type: newType, children: [] }
  return { ...field, type: newType, defaultValue: field.defaultValue ?? '', children: [] }
}

export function FormFlowBuilderScreen() {
  const location = useLocation()
  const initialTemplate = (location.state as { template?: SavedFormFlowTemplate } | null)?.template

  const [pasteText, setPasteText] = useState('')
  const [formatOverride, setFormatOverride] = useState<SourceFormat | undefined>(undefined)
  const [schema, setSchema] = useState<FormFlowSchema | null>(initialTemplate?.schema ?? null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [templateName, setTemplateName] = useState<string | null>(initialTemplate?.name ?? null)
  const [saveDialogName, setSaveDialogName] = useState('')
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const { control, register, reset } = useForm<Record<string, unknown>>({
    defaultValues: initialTemplate?.values ?? {},
  })

  function handleParse() {
    try {
      const parsed = parser.parse(pasteText, formatOverride)
      setSchema(parsed)
      setParseError(null)
      reset(defaultValuesFromFields(parsed.fields))
    } catch (e) {
      setSchema(null)
      setParseError(messageOf(e))
    }
  }

  function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    file.text().then((text) => setPasteText(text))
    e.target.value = ''
  }

  function replaceTopField(index: number, updated: SchemaField) {
    setSchema((prev) => {
      if (!prev) return prev
      const fields = [...prev.fields]
      fields[index] = updated
      const next = { ...prev, fields }
      reset(defaultValuesFromFields(next.fields))
      return next
    })
  }

  async function handleSaveTemplate() {
    if (!schema || saveDialogName.trim().length === 0) return
    const name = saveDialogName.trim()
    const values = control._formValues
    const template: SavedFormFlowTemplate = { name, schema, values }
    await repository.save(name, JSON.stringify(template))
    setTemplateName(name)
    setSaveStatus(`Saved "${name}"`)
    setSaveDialogName('')
  }

  const output = useOutput(schema, control)

  return (
    <ToolDetailScaffold
      title="FormFlow Builder"
      copyText={output.text ?? undefined}
      inputPanel={
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium">Upload file</p>
          <p className="text-sm text-muted-foreground">
            Drop an XML, YAML or JSON file below — or paste its contents directly.
          </p>
          <Input type="file" accept=".xml,.yaml,.yml,.json" onChange={handleFilePicked} />
          <Textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={10}
            className="font-mono text-xs"
            placeholder={'<config>\n  <server>...</server>\n</config>'}
          />
          <div className="flex gap-2">
            <Select
              value={formatOverride ?? 'auto'}
              onValueChange={(v) => setFormatOverride(v === 'auto' ? undefined : ((v as SourceFormat) ?? undefined))}
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Auto-detect format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto-detect format</SelectItem>
                {SOURCE_FORMATS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleParse}>Parse</Button>
          </div>
          {parseError ? <p className="text-sm text-destructive">Could not parse: {parseError}</p> : null}

          {schema ? (
            <>
              <div className="mt-4 flex items-center gap-2 border-t border-border/60 pt-4">
                <p className="flex-1 text-sm font-medium">Schema designer & field mapper</p>
                <Dialog>
                  <DialogTrigger
                    render={
                      <Button variant="outline" size="sm">
                        <Save className="size-4" />
                        Save template
                      </Button>
                    }
                  />
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Save template</DialogTitle>
                    </DialogHeader>
                    <Label htmlFor="template-name">Template name</Label>
                    <Input
                      id="template-name"
                      autoFocus
                      value={saveDialogName}
                      onChange={(e) => setSaveDialogName(e.target.value)}
                    />
                    <DialogFooter>
                      <DialogTrigger render={<Button onClick={handleSaveTemplate}>Save</Button>} />
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              {saveStatus ? <p className="text-sm text-primary">{saveStatus}</p> : null}
              <p className="text-sm text-muted-foreground">
                Detected root "{schema.rootName}" ({schema.format.toUpperCase()})
                {templateName ? ` · Saved as "${templateName}"` : ''}
              </p>
              <div className="flex flex-col gap-1">
                {schema.fields.map((field, i) => (
                  <DesignerFieldRow key={field.key} field={field} onChange={(updated) => replaceTopField(i, updated)} />
                ))}
              </div>
            </>
          ) : null}
        </div>
      }
      outputPanel={
        !schema ? (
          <p className="text-sm text-muted-foreground">Parse a file on the left to see the live interactive form here.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm font-medium">Live interactive form</p>
            <div className="flex flex-col gap-3">
              {schema.fields.map((field) => (
                <LiveFormField key={field.key} field={field} path={field.key} control={control} register={register} />
              ))}
            </div>
            <div className="border-t border-border/60 pt-4">
              <p className="text-sm font-medium">Generated output</p>
              {output.error ? (
                <p className="mt-2 text-sm text-destructive">Could not render: {output.error}</p>
              ) : (
                <pre className="mt-2 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                  {output.text}
                </pre>
              )}
            </div>
          </div>
        )
      }
    />
  )
}

function useOutput(
  schema: FormFlowSchema | null,
  // RHF's `FieldArrayPath`/`FieldPath` utility types resolve to `never` for
  // an index-signature type like `Record<string, unknown>` — they need
  // literal keys to recurse into. FormFlow's whole point is a
  // runtime-determined schema shape, so static path validation isn't
  // attainable here regardless; `Control<any>` sidesteps the dead-end
  // inference instead of fighting it with per-call casts.
  control: Control<any>,
): { text: string | null; error: string | null } {
  const values = useWatch({ control })
  return useMemo(() => {
    if (!schema) return { text: null, error: null }
    try {
      return { text: parser.render(schema, values as Record<string, unknown>), error: null }
    } catch (e) {
      return { text: null, error: messageOf(e) }
    }
  }, [schema, values])
}

// ---------------------------------------------------------------------
// Designer pane: schema field tree + FieldType reclassification
// ---------------------------------------------------------------------

function DesignerFieldRow({
  field,
  onChange,
  depth = 0,
}: {
  field: SchemaField
  onChange: (updated: SchemaField) => void
  depth?: number
}) {
  const isContainer = field.type === 'object' || field.type === 'array'

  return (
    <div style={{ paddingLeft: depth * 16 }} className="py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1 truncate font-mono text-[13px]">{field.key}</span>
        <Select value={field.type} onValueChange={(v) => v && v !== field.type && onChange(retypeField(field, v as FieldType))}>
          <SelectTrigger size="sm" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FIELD_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {isContainer ? (
        <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={field.type === 'array'}
            onCheckedChange={(checked) => {
              const newType: FieldType = checked ? 'array' : 'object'
              if (newType !== field.type) onChange({ ...field, type: newType })
            }}
          />
          Mark as Dynamic Array Loop
        </label>
      ) : null}
      {isContainer
        ? field.children.map((child, i) => (
            <DesignerFieldRow
              key={child.key}
              field={child}
              depth={depth + 1}
              onChange={(updatedChild) => {
                const newChildren = [...field.children]
                newChildren[i] = updatedChild
                onChange({ ...field, children: newChildren })
              }}
            />
          ))
        : null}
    </div>
  )
}

// ---------------------------------------------------------------------
// Runner pane: real react-hook-form-driven inputs, including
// useFieldArray-backed "+ Add Item" loops for `array` fields.
// ---------------------------------------------------------------------

interface LiveFormFieldProps {
  field: SchemaField
  path: string
  // RHF's `FieldArrayPath`/`FieldPath` utility types resolve to `never` for
  // an index-signature type like `Record<string, unknown>` — they need
  // literal keys to recurse into. FormFlow's whole point is a
  // runtime-determined schema shape, so static path validation isn't
  // attainable here regardless; `Control<any>` sidesteps the dead-end
  // inference instead of fighting it with per-call casts.
  control: Control<any>
  register: ReturnType<typeof useForm<Record<string, unknown>>>['register']
}

function LiveFormField({ field, path, control, register }: LiveFormFieldProps) {
  switch (field.type) {
    case 'text':
      return (
        <div className="flex flex-col gap-1">
          <Label>{fieldDisplayLabel(field)}</Label>
          <Input {...register(path)} />
        </div>
      )
    case 'number':
      return (
        <div className="flex flex-col gap-1">
          <Label>{fieldDisplayLabel(field)}</Label>
          <Input type="text" inputMode="decimal" {...register(path)} />
        </div>
      )
    case 'boolean':
      return (
        <Controller
          name={path}
          control={control}
          render={({ field: rhf }) => (
            <label className="flex items-center justify-between gap-2">
              <span className="text-sm">{fieldDisplayLabel(field)}</span>
              <Switch checked={Boolean(rhf.value)} onCheckedChange={rhf.onChange} />
            </label>
          )}
        />
      )
    case 'object':
      return (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="mb-2 text-sm font-semibold">{fieldDisplayLabel(field)}</p>
          <div className="flex flex-col gap-3">
            {field.children.map((child) => (
              <LiveFormField key={child.key} field={child} path={`${path}.${child.key}`} control={control} register={register} />
            ))}
          </div>
        </div>
      )
    case 'array':
      return <LiveArrayField field={field} path={path} control={control} register={register} />
  }
}

function LiveArrayField({ field, path, control, register }: LiveFormFieldProps) {
  const { fields: items, append, remove } = useFieldArray({ control, name: path })
  const seeded = useRef(false)

  // Seed one item on first mount if the array happens to be empty (e.g. an
  // empty array in the parsed source, or after a fresh retype) so the loop
  // isn't presented with zero rows and no obvious way to see the shape.
  useEffect(() => {
    if (!seeded.current && items.length === 0 && field.children.length > 0) {
      seeded.current = true
      append(defaultValuesFromFields(field.children))
    }
  }, [items.length, field.children, append])

  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="mb-2 text-sm font-semibold">{fieldDisplayLabel(field)} — Dynamic Array Loop</p>
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          <div key={item.id} className="flex items-start gap-2 rounded-lg border border-border/60 bg-background p-2.5">
            <div className="flex-1 flex flex-col gap-3">
              {field.children.map((child) => (
                <LiveFormField
                  key={child.key}
                  field={child}
                  path={`${path}.${index}.${child.key}`}
                  control={control}
                  register={register}
                />
              ))}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} aria-label="Remove item">
              <X className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => append(defaultValuesFromFields(field.children))}
      >
        <Plus className="size-4" />
        Add Item
      </Button>
    </div>
  )
}
