/** Outbound port: persistence for user-saved FormFlow schemas/templates. */
export interface ISchemaRepository {
  listNames(): Promise<string[]>
  load(name: string): Promise<string | null>
  save(name: string, schemaJson: string): Promise<void>
  delete(name: string): Promise<void>
}
