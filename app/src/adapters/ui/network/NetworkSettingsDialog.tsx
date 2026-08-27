import type { ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useNetworkSettingsStore, type GeoProvider } from '@/stores/networkSettingsStore'

/**
 * Module-scoped settings for the Network Toolkit — opened from the gear at the
 * bottom of the module's tool list. Every field is a default the individual
 * tools read; per-tool Advanced params can still override. See
 * NETWORK_MODULE_PLAN.md §3.1.
 */
export function NetworkSettingsDialog({ trigger }: { trigger: ReactElement }) {
  const s = useNetworkSettingsStore()

  return (
    <Dialog>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Network Toolkit settings</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="flex flex-col gap-5 pr-3">
            <Section title="Connection">
              <Field label="Default network interface" hint="Blank = OS routing table. Tools can override.">
                <Input
                  value={s.defaultInterface ?? ''}
                  placeholder="auto"
                  onChange={(e) => s.update({ defaultInterface: e.target.value.trim() || null })}
                />
              </Field>
              <Field
                label="Proxy URL"
                hint="HTTP tools + Whois only. ICMP / traceroute / UDP DNS / SNMP / NTP cannot use a proxy."
              >
                <Input
                  value={s.proxyUrl}
                  placeholder="http://host:port  or  socks5://host:port"
                  onChange={(e) => s.update({ proxyUrl: e.target.value.trim() })}
                />
              </Field>
              {s.proxyUrl ? (
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Proxy user">
                    <Input value={s.proxyUser} onChange={(e) => s.update({ proxyUser: e.target.value })} />
                  </Field>
                  <Field label="Proxy password">
                    <Input
                      type="password"
                      value={s.proxyPassword}
                      onChange={(e) => s.update({ proxyPassword: e.target.value })}
                    />
                  </Field>
                </div>
              ) : null}
            </Section>

            <Section title="Name resolution">
              <Field label="Custom DNS servers" hint='";"-separated IPs. Blank = OS resolvers. App-wide PTR/hostname lookups.'>
                <Input
                  value={s.customDnsServers}
                  placeholder="1.1.1.1; 1.0.0.1"
                  onChange={(e) => s.update({ customDnsServers: e.target.value })}
                />
              </Field>
              <ToggleField
                label="Prefer IPv4 when resolving"
                checked={s.preferIpv4}
                onChange={(v) => s.update({ preferIpv4: v })}
              />
            </Section>

            <Section title="Defaults">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Timeout (ms)">
                  <Input
                    type="number"
                    min={100}
                    value={s.defaultTimeoutMs}
                    onChange={(e) => s.update({ defaultTimeoutMs: clampInt(e.target.value, 100, 900000, 4000) })}
                  />
                </Field>
                <Field label="Retries">
                  <Input
                    type="number"
                    min={0}
                    value={s.defaultRetries}
                    onChange={(e) => s.update({ defaultRetries: clampInt(e.target.value, 0, 10, 2) })}
                  />
                </Field>
              </div>
            </Section>

            <Section title="IP geolocation">
              <Field label="Provider">
                <Select value={s.geoProvider} onValueChange={(v) => s.update({ geoProvider: (v as GeoProvider) ?? 'ip-api' })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ip-api">ip-api.com (online, no key)</SelectItem>
                    <SelectItem value="maxmind">MaxMind GeoLite2 (offline, your key)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {s.geoProvider === 'maxmind' ? (
                <Field label="MaxMind license key">
                  <Input
                    value={s.maxmindLicenseKey}
                    onChange={(e) => s.update({ maxmindLicenseKey: e.target.value.trim() })}
                  />
                </Field>
              ) : null}
            </Section>

            <Section title="History">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Retention (days)">
                  <Input
                    type="number"
                    min={1}
                    value={s.historyRetentionDays}
                    onChange={(e) => s.update({ historyRetentionDays: clampInt(e.target.value, 1, 3650, 90) })}
                  />
                </Field>
                <Field label="Keep per target">
                  <Input
                    type="number"
                    min={1}
                    value={s.historyMaxPerTarget}
                    onChange={(e) => s.update({ historyMaxPerTarget: clampInt(e.target.value, 1, 1000, 20) })}
                  />
                </Field>
              </div>
              <ToggleField
                label="Auto-save every run to history"
                checked={s.autoSaveHistory}
                onChange={(v) => s.update({ autoSaveHistory: v })}
              />
            </Section>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="ghost" onClick={() => s.reset()}>
            Reset to defaults
          </Button>
          <DialogClose render={<Button variant="secondary">Done</Button>} />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function ToggleField({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
