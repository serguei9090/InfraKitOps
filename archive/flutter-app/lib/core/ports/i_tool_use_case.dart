/// Inbound port: standard contract the UI uses to invoke a tool's
/// calculation/generation logic without knowing its implementation.
abstract interface class IToolUseCase<TInput, TOutput> {
  TOutput execute(TInput input);
}
