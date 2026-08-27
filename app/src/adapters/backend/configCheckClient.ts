import { backendPost } from './backendClient'

export type ConfigCheckKind = 'nginx' | 'sshd' | 'ssh' | 'nftables' | 'fail2ban' | 'sysctl'

export interface ConfigCheckMessage {
  level: 'error' | 'warning' | 'info'
  line?: number
  text: string
}

export interface ConfigCheckResult {
  kind: ConfigCheckKind
  validator: string
  /** False when the validator binary is not installed on the backend host. */
  available: boolean
  ok: boolean
  messages: ConfigCheckMessage[]
  raw?: string
}

/** POST /config/validate — runs the matching `-t` / check-mode validator. */
export function validateConfig(
  kind: ConfigCheckKind,
  text: string,
  signal?: AbortSignal,
): Promise<ConfigCheckResult> {
  return backendPost<ConfigCheckResult>('/config/validate', { kind, text }, signal)
}
