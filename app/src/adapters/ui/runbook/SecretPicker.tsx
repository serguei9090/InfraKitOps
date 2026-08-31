import { Lock } from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useVaultStore } from '@/stores/vaultStore'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** restrict to secrets of these kinds */
  kinds?: string[]
  /** what the value is keyed by: 'id' for step auth config (engine resolves by
   *  id), 'name' for secret-typed args (engine resolves by name). Default 'id'. */
  by?: 'id' | 'name'
}

/** Dropdown of vault secrets. Shows a lock hint when the vault is locked. */
export function SecretPicker({ value, onChange, placeholder = 'select a secret', kinds, by = 'id' }: Props) {
  const status = useVaultStore((s) => s.status)
  const secrets = useVaultStore((s) => s.secrets)

  if (!status?.unlocked) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lock className="size-3" /> unlock the vault to pick a secret
      </span>
    )
  }

  const options = kinds ? secrets.filter((s) => kinds.includes(s.kind)) : secrets

  return (
    <Select value={value || undefined} onValueChange={(v) => v && onChange(v)}>
      <SelectTrigger size="sm" className="w-full text-xs">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <SelectItem value="__none" disabled>
            no secrets yet
          </SelectItem>
        ) : (
          options.map((s) => (
            <SelectItem key={s.id} value={by === 'name' ? s.name : s.id}>
              {s.name} <span className="text-muted-foreground">· {s.kind}</span>
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
