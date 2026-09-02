/**
 * FormFlow's shared data model — the frozen contract between the parsing
 * engine, the designer/runner UI, and the template storage layer, so all
 * three can be built independently against a stable shape. Mirrors
 * `schema_model.dart`. Every type here is plain-JSON-serializable by
 * design, so template persistence is just `JSON.stringify`/`JSON.parse` —
 * no hand-written `toJson`/`fromJson` needed (unlike the Dart original,
 * which had to write those by hand).
 */

export type SourceFormat = 'xml' | 'yaml' | 'json'

export const SOURCE_FORMAT_LABELS: Record<SourceFormat, string> = {
  xml: 'XML',
  yaml: 'YAML',
  json: 'JSON',
}

export type FieldType = 'text' | 'number' | 'boolean' | 'object' | 'array'

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text Input',
  number: 'Number Input',
  boolean: 'Switch Toggle',
  object: 'Group',
  array: 'Dynamic Array Loop',
}

/**
 * One detected node in the source file: a leaf (text/number/boolean) or a
 * container (object/array) with `children` describing its shape. For an
 * `array` field, `children` is the per-item template — the form runner
 * clones it once per array entry.
 */
export interface SchemaField {
  /** Tag/property name as it appears in the source file. */
  key: string
  type: FieldType
  /** Display label; falls back to `key` when unset. */
  label?: string
  /**
   * Author-written explanation + examples for whoever fills the form. Shown
   * as a `?` tooltip next to the field on the runner side. Plain text,
   * newlines allowed.
   */
  help?: string
  /** Only meaningful for scalar leaf types (text/number/boolean). */
  defaultValue?: string
  /** Sub-fields for object/array types; empty for scalar leaves. */
  children: SchemaField[]
}

export function fieldDisplayLabel(field: SchemaField): string {
  return field.label ?? field.key
}

/**
 * A fully-detected schema for one uploaded file: its source format (needed
 * to know how to re-serialize), the root element's tag/name (XML/JSON need
 * a wrapping root; YAML doesn't), and the top-level fields.
 */
export interface FormFlowSchema {
  format: SourceFormat
  /** Root tag name for XML (e.g. "config"), or a display name for YAML/JSON. */
  rootName: string
  fields: SchemaField[]
}

/**
 * A named, saved FormFlow template — the schema plus whatever values the
 * user had filled in when they saved it, so reopening it restores the form
 * as they left it. `values` mirrors the shape `FormFlowParser.render`
 * expects: nested objects for `object` fields, arrays of objects for
 * `array` fields (one object per item), raw scalars for leaves.
 */
export interface SavedFormFlowTemplate {
  name: string
  schema: FormFlowSchema
  values: Record<string, unknown>
}

/**
 * Synthetic key used as the sole child of an `array` field whose items are
 * scalars rather than objects — e.g. a JSON/YAML list of plain strings
 * (`["a", "b"]`), or repeated XML leaf siblings. A scalar item has no
 * natural key of its own, so it's represented as a single-field template
 * `[value: <type>]`, and the corresponding runtime item is `{value: <the
 * scalar>}`. The parser/renderer recognize this exact shape and unwrap it
 * back to a bare scalar on render.
 */
export const SCALAR_ARRAY_ITEM_KEY = 'value'

export function isScalarArrayTemplate(children: SchemaField[]): boolean {
  return children.length === 1 && children[0].key === SCALAR_ARRAY_ITEM_KEY
}

/**
 * Seeds a values tree from a field list's own detected defaults — used both
 * to pre-fill the form right after parsing (one array item per `array`
 * field, matching the "first occurrence" the template came from) and to
 * build a fresh item when "+ Add Item" is pressed.
 */
export function defaultValuesFromFields(fields: SchemaField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    switch (field.type) {
      case 'object':
        values[field.key] = defaultValuesFromFields(field.children)
        break
      case 'array':
        values[field.key] = field.children.length === 0 ? [] : [defaultValuesFromFields(field.children)]
        break
      case 'boolean':
        values[field.key] = field.defaultValue?.toLowerCase() === 'true'
        break
      case 'number':
      case 'text':
        values[field.key] = field.defaultValue ?? ''
        break
    }
  }
  return values
}
