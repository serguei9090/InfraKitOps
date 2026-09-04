/** One saved FormFlow form in a list. */
export interface SchemaEntry {
  id: string
  name: string
  /** false for a form shared read-only with the caller. */
  canEdit: boolean
  /** reached via a share grant, not owned (multi-user only). */
  shared: boolean
}

/** Outbound port: persistence for user-saved FormFlow forms/templates.
 *  id-keyed — `save(null, …)` creates and returns a fresh id. */
export interface ISchemaRepository {
  list(): Promise<SchemaEntry[]>
  load(id: string): Promise<string | null>
  save(id: string | null, name: string, schemaJson: string): Promise<string>
  delete(id: string): Promise<void>
}
