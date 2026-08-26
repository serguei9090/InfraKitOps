/**
 * Inbound port: parses a raw structured-file payload (XML/YAML/JSON) into a
 * FormFlow schema and renders values back out in the original format.
 */
export interface IFormFlowUseCase<TSchema> {
  parse(rawContent: string): TSchema
  render(schema: TSchema, values: Record<string, unknown>): string
}
