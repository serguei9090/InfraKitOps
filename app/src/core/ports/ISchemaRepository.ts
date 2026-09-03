/** Outbound port: persistence for user-saved FormFlow schemas/templates. */
export interface ISchemaRepository {
  listNames(): Promise<string[]>
  load(name: string): Promise<string | null>
  save(name: string, schemaJson: string): Promise<void>
  delete(name: string): Promise<void>
  /**
   * Multi-user only: the server id of a form the caller owns, for the share
   * dialog. `undefined` in single-user mode or for a not-yet-saved / shared
   * form. Populated by `listNames()` / `load()`.
   */
  ownedFormId?(name: string): string | undefined
}
