/// Inbound port: parses a raw structured-file payload (XML/YAML/JSON) into
/// a FormFlow schema and renders values back out in the original format.
abstract interface class IFormFlowUseCase<TSchema> {
  TSchema parse(String rawContent);

  String render(TSchema schema, Map<String, Object?> values);
}
