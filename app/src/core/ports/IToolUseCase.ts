/**
 * Inbound port every tool's core logic implements. UI adapters call `execute`
 * and never touch the tool's internals directly — mirrors `IToolUseCase` in
 * the Flutter reference app (`lib/core/ports/i_tool_use_case.dart`).
 */
export interface IToolUseCase<TInput, TOutput> {
  execute(input: TInput): TOutput | Promise<TOutput>
}
