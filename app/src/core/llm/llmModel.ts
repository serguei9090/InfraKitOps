/**
 * AI module — core model, mirrors backend/internal/llm/model.go. Framework-free
 * (no React), same rule as the rest of `src/core/**`. See AI_MODULE_PLAN.md §4.
 */

export type ProviderKind = 'ollama' | 'openai-compatible' | 'anthropic' | 'gemini'

export const PROVIDER_LABEL: Record<ProviderKind, string> = {
  ollama: 'Ollama',
  'openai-compatible': 'OpenAI-compatible',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
}

/** Every provider kind the backend can serve; it confirms the live set via
 *  `capabilities.llmProviders`. */
export const ALL_PROVIDERS: ProviderKind[] = ['ollama', 'openai-compatible', 'anthropic', 'gemini']

export const PROVIDER_DEFAULT_URL: Record<ProviderKind, string> = {
  ollama: 'http://localhost:11434',
  'openai-compatible': 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
}

/** Providers that can run with no API key (local runtimes). */
export const PROVIDER_KEYLESS_OK: Record<ProviderKind, boolean> = {
  ollama: true,
  'openai-compatible': true,
  anthropic: false,
  gemini: false,
}

export interface LlmConnection {
  id: string
  name: string
  provider: ProviderKind
  baseUrl: string
  authSecretId?: string
  defaultModel?: string
  createdAt: number
}

export interface LlmModel {
  id: string
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
}

/** A tool call the model made mid-answer (A4b / A4c). */
export interface ChatToolStep {
  id: string
  name: string
  args?: Record<string, unknown>
  /** set while a non-read-only call waits for the user's decision (A4c) */
  approvalId?: string
  /** the user declined this call */
  denied?: boolean
  /** filled in once the tool-result event arrives */
  done?: boolean
  ok?: boolean
  result?: string
}

export function emptyConnection(provider: ProviderKind = 'ollama'): Partial<LlmConnection> {
  return { name: '', provider, baseUrl: '', defaultModel: '' }
}

// --- grounding tasks ------------------------------------------------------

export type TaskOutputShape = 'text' | 'diff' | 'json'

export interface LlmTask {
  id: string
  title: string
  description?: string
  builtin: boolean
  /** a built-in that a custom row currently overrides */
  overridden?: boolean
  systemTemplate: string
  inputLabel?: string
  outputShape: TaskOutputShape
  suggestedModel?: string
  temperature?: number
  /** preferred connection + model for this task (set from Settings) */
  preferredConnectionId?: string
  preferredModel?: string
}

/** Global AI defaults, stored server-side in llm_settings. */
export interface LlmSettings {
  defaultConnectionId?: string
  defaultModel?: string
  defaultTemperature?: string
}

export function emptyTask(): LlmTask {
  return { id: '', title: '', builtin: false, systemTemplate: '', outputShape: 'text' }
}

/** The tokens a task template references, minus `{{input}}`. */
export function taskContextKeys(t: LlmTask): string[] {
  const seen = new Set<string>()
  for (const m of t.systemTemplate.matchAll(/\{\{\s*context\.([A-Za-z0-9_.]+)\s*\}\}/g)) seen.add(m[1])
  return [...seen]
}

