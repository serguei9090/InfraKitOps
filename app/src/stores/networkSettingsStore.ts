import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { syncedStorage } from '@/adapters/storage/syncedSettings'

export type GeoProvider = 'ip-api' | 'maxmind'

export interface NetworkSettings {
  /** Interface name to send from; null = let the OS routing table decide. Per-tool overridable. */
  defaultInterface: string | null
  /** Outbound proxy for HTTP-based tools + Whois. "" = none. http:// or socks5://. */
  proxyUrl: string
  proxyUser: string
  proxyPassword: string
  /** ";"-separated resolver IPs for app-wide PTR/hostname resolution. "" = OS resolvers. */
  customDnsServers: string
  preferIpv4: boolean
  /** Seeds each tool's Advanced params. */
  defaultTimeoutMs: number
  defaultRetries: number
  geoProvider: GeoProvider
  maxmindLicenseKey: string
  historyRetentionDays: number
  historyMaxPerTarget: number
  autoSaveHistory: boolean
}

export const DEFAULT_NETWORK_SETTINGS: NetworkSettings = {
  defaultInterface: null,
  proxyUrl: '',
  proxyUser: '',
  proxyPassword: '',
  customDnsServers: '',
  preferIpv4: true,
  defaultTimeoutMs: 4000,
  defaultRetries: 2,
  geoProvider: 'ip-api',
  maxmindLicenseKey: '',
  historyRetentionDays: 90,
  historyMaxPerTarget: 20,
  autoSaveHistory: true,
}

interface NetworkSettingsStore extends NetworkSettings {
  update: (patch: Partial<NetworkSettings>) => void
  reset: () => void
}

/**
 * Module-scoped settings for the Network Toolkit, edited from the gear at the
 * bottom of the module's tool list. Persisted through IStoragePort (localStorage
 * on web, a file on desktop). Every network tool reads these for its defaults —
 * see NETWORK_MODULE_PLAN.md §3.1.
 */
export const useNetworkSettingsStore = create<NetworkSettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_NETWORK_SETTINGS,
      update: (patch) => set(patch),
      reset: () => set(DEFAULT_NETWORK_SETTINGS),
    }),
    {
      name: 'network-settings',
      storage: createJSONStorage(() => syncedStorage()),
      merge: (persisted, current) => ({
        ...current,
        ...DEFAULT_NETWORK_SETTINGS,
        ...(persisted as Partial<NetworkSettings> | undefined),
      }),
    },
  ),
)
