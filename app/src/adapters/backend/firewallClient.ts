import { backendPost } from './backendClient'
import type { FirewallResult } from '@/core/network/toolResults'

export type FirewallChangeOp = 'add' | 'delete' | 'set-enabled'

export interface FirewallRuleSpec {
  name: string
  direction: 'inbound' | 'outbound'
  action: 'allow' | 'block'
  protocol: 'tcp' | 'udp' | 'any'
  localPort: string
  remoteAddr: string
  enabled: boolean
}

export interface FirewallChangeResponse {
  ok?: boolean
  needsConfirmation?: boolean
  warnings?: string[]
  result?: FirewallResult
}

/**
 * POST /firewall/change — add / delete / enable-disable one OS firewall rule
 * (Windows only). A risky change comes back with `needsConfirmation:true` and
 * `warnings`; re-call with `confirmed:true` to actually apply it (one UAC
 * prompt on the backend side).
 */
export function firewallChange(
  op: FirewallChangeOp,
  rule: FirewallRuleSpec,
  confirmed: boolean,
  signal?: AbortSignal,
): Promise<FirewallChangeResponse> {
  return backendPost<FirewallChangeResponse>('/firewall/change', { op, rule, confirmed }, signal)
}
