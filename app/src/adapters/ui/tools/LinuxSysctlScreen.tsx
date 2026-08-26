import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  LinuxSysctlTuner,
  networkInterfaceProfileDescription,
  type LinuxSysctlInput,
  type NetworkInterfaceProfile,
} from '@/core/tuning/linuxSysctlTuner'

const tuner = new LinuxSysctlTuner()

const interfaceProfiles: NetworkInterfaceProfile[] = ['oneGigabit', 'tenGigabit', 'fortyToHundredGigabit']

const defaultInput: LinuxSysctlInput = {
  interfaceProfile: 'tenGigabit',
  enableBbr: true,
  enableTimeWaitReuse: true,
  synBacklog: 8192,
  socketMemoryGb: 16,
}

export function LinuxSysctlScreen() {
  const [input, setInput] = useState<LinuxSysctlInput>(defaultInput)

  const result = useMemo(() => {
    try {
      return { value: tuner.execute(input), error: null }
    } catch (e) {
      return { value: null, error: e instanceof Error ? e.message : String(e) }
    }
  }, [input])

  function update<K extends keyof LinuxSysctlInput>(key: K, value: LinuxSysctlInput[K]) {
    setInput((s) => ({ ...s, [key]: value }))
  }

  return (
    <ToolDetailScaffold
      title="Linux Kernel Sysctl"
      copyText={result.value?.configText}
      inputPanel={
        <div className="flex max-w-md flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Label>Network Interface Speed Profile</Label>
            <RadioGroup
              value={input.interfaceProfile}
              onValueChange={(value) => update('interfaceProfile', value as NetworkInterfaceProfile)}
            >
              {interfaceProfiles.map((profile) => (
                <div key={profile} className="flex items-center gap-2">
                  <RadioGroupItem value={profile} id={`profile-${profile}`} />
                  <Label htmlFor={`profile-${profile}`} className="font-normal">
                    {networkInterfaceProfileDescription(profile)}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="enable-bbr">Enable BBR Congestion Control</Label>
              <p className="text-xs text-muted-foreground">Toggles fq + tcp_bbr modules</p>
            </div>
            <Switch id="enable-bbr" checked={input.enableBbr} onCheckedChange={(v) => update('enableBbr', v)} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="enable-tw-reuse">Enable TIME_WAIT Socket Reuse</Label>
            <Switch
              id="enable-tw-reuse"
              checked={input.enableTimeWaitReuse}
              onCheckedChange={(v) => update('enableTimeWaitReuse', v)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>TCP SYN Backlog Queue Size: {input.synBacklog}</Label>
            <Slider
              value={input.synBacklog}
              min={LinuxSysctlTuner.minSynBacklog}
              max={LinuxSysctlTuner.maxSynBacklog}
              step={64}
              onValueChange={(v) => update('synBacklog', v as number)}
            />
            <p className="text-xs text-muted-foreground">
              (Min: {LinuxSysctlTuner.minSynBacklog}, Max: {LinuxSysctlTuner.maxSynBacklog})
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label>System Memory Allocated for Sockets (GB): {input.socketMemoryGb}</Label>
            <Slider
              value={input.socketMemoryGb}
              min={LinuxSysctlTuner.minSocketMemoryGb}
              max={LinuxSysctlTuner.maxSocketMemoryGb}
              step={1}
              onValueChange={(v) => update('socketMemoryGb', v as number)}
            />
            <p className="text-xs text-muted-foreground">
              (Min: {LinuxSysctlTuner.minSocketMemoryGb} GB, Max: {LinuxSysctlTuner.maxSocketMemoryGb} GB)
            </p>
          </div>
        </div>
      }
      outputPanel={
        result.error ? (
          <p className="text-sm text-destructive">{result.error}</p>
        ) : result.value ? (
          <div className="flex flex-col gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Generated sysctl configuration</p>
              <pre className="mt-2 max-w-full overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs">
                {result.value.configText}
              </pre>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">net.core.somaxconn</dt>
              <dd className="font-mono">{result.value.somaxconn}</dd>
              <dt className="text-muted-foreground">tcp_max_syn_backlog</dt>
              <dd className="font-mono">{result.value.tcpMaxSynBacklog}</dd>
              <dt className="text-muted-foreground">default_qdisc</dt>
              <dd className="font-mono">{result.value.defaultQdisc}</dd>
              <dt className="text-muted-foreground">tcp_congestion_control</dt>
              <dd className="font-mono">{result.value.tcpCongestionControl}</dd>
              <dt className="text-muted-foreground">rmem_max / wmem_max</dt>
              <dd className="font-mono">{result.value.rmemMax}</dd>
              <dt className="text-muted-foreground">tcp_rmem</dt>
              <dd className="font-mono">{result.value.tcpRmem}</dd>
              <dt className="text-muted-foreground">tcp_wmem</dt>
              <dd className="font-mono">{result.value.tcpWmem}</dd>
            </dl>
          </div>
        ) : null
      }
    />
  )
}
