import { useEffect, useState } from 'react'
import { backendGet } from '@/adapters/backend/backendClient'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface IfaceAddr {
  cidr: string
  family: 'v4' | 'v6'
  address: string
}
interface Iface {
  name: string
  mtu: number
  up: boolean
  loopback: boolean
  addrs: IfaceAddr[]
}

interface InterfacePickerProps {
  /** Selected source IPv4 address, or '' for the OS default route. */
  value: string
  onChange: (sourceIp: string) => void
}

/**
 * Source-interface picker for tools that can bind their probes (network
 * scanner). Lists the host's up, non-loopback IPv4 interfaces from
 * GET /api/v1/interfaces. See NETWORK_MODULE_PLAN.md §3.
 */
export function InterfacePicker({ value, onChange }: InterfacePickerProps) {
  const [ifaces, setIfaces] = useState<{ label: string; ip: string }[]>([])

  useEffect(() => {
    backendGet<{ interfaces: Iface[] }>('/interfaces')
      .then(({ interfaces }) => {
        const opts: { label: string; ip: string }[] = []
        for (const ifi of interfaces) {
          if (!ifi.up || ifi.loopback) continue
          for (const a of ifi.addrs) {
            if (a.family !== 'v4') continue
            opts.push({ label: `${ifi.name} — ${a.address}  (MTU ${ifi.mtu})`, ip: a.address })
          }
        }
        setIfaces(opts)
      })
      .catch(() => setIfaces([]))
  }, [])

  return (
    <Select value={value || 'auto'} onValueChange={(v) => onChange(v && v !== 'auto' ? v : '')}>
      <SelectTrigger className="w-72">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Auto (OS routing table)</SelectItem>
        {ifaces.map((o) => (
          <SelectItem key={o.ip} value={o.ip}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
