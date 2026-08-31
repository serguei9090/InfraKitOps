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

/** Providers implemented in A0; the backend confirms via `llmProviders`. */
export const A0_PROVIDERS: ProviderKind[] = ['ollama', 'openai-compatible']

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

export function emptyConnection(provider: ProviderKind = 'ollama'): Partial<LlmConnection> {
  return { name: '', provider, baseUrl: '', defaultModel: '' }
}
