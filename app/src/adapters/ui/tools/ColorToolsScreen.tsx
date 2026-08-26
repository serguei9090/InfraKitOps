import { useMemo, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ToolDetailScaffold } from '@/adapters/ui/shell/ToolDetailScaffold'
import {
  COLOR_BLINDNESS_TYPES,
  ColorBlindnessSimulator,
  hexToRgb,
  hslToRgb,
  rgbToHex,
  rgbToHsl,
  type ColorBlindnessType,
  type HslColor,
  type RgbColor,
} from '@/core/office_media/colorTools'

const simulator = new ColorBlindnessSimulator()

const CVD_LABELS: Record<ColorBlindnessType, string> = {
  protanopia: 'Protanopia (red-blind)',
  deuteranopia: 'Deuteranopia (green-blind)',
  tritanopia: 'Tritanopia (blue-blind)',
}

/** Material 500 ramp + black/white/gray — covers the hues people reach for when sanity-checking a palette. */
const PRESET_SWATCHES = [
  '#000000',
  '#6B7280',
  '#FFFFFF',
  '#EF4444',
  '#F97316',
  '#F59E0B',
  '#84CC16',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#3B82F6',
  '#4F46E5',
  '#8B5CF6',
  '#D946EF',
  '#EC4899',
]

const DEFAULT_RGB: RgbColor = { r: 79, g: 70, b: 229 } // brand indigo

export function ColorToolsScreen() {
  const [rgb, setRgb] = useState<RgbColor>(DEFAULT_RGB)
  const hsl = useMemo(() => rgbToHsl(rgb), [rgb])
  const hex = rgbToHex(rgb)
  const simulated = useMemo(() => simulator.execute(rgb), [rgb])

  function applyHex(value: string) {
    try {
      setRgb(hexToRgb(value))
    } catch {
      // Incomplete/invalid hex mid-edit (e.g. "#1") — wait for a valid value.
    }
  }

  function applyRgbField(patch: Partial<RgbColor>) {
    const next = { ...rgb, ...patch }
    if (
      next.r < 0 ||
      next.r > 255 ||
      next.g < 0 ||
      next.g > 255 ||
      next.b < 0 ||
      next.b > 255 ||
      Number.isNaN(next.r) ||
      Number.isNaN(next.g) ||
      Number.isNaN(next.b)
    ) {
      return
    }
    setRgb(next)
  }

  function applyHslField(patch: Partial<HslColor>) {
    const next = { ...hsl, ...patch }
    if (next.s < 0 || next.s > 100 || next.l < 0 || next.l > 100) return
    setRgb(hslToRgb(next))
  }

  return (
    <ToolDetailScaffold
      title="Color Tools"
      copyText={hex}
      inputPanel={
        <div className="flex max-w-md flex-col gap-6">
          <div className="flex items-center gap-4">
            <input
              type="color"
              value={hex}
              onChange={(e) => applyHex(e.target.value)}
              className="h-16 w-16 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
              aria-label="Pick a color"
            />
            <p className="text-sm text-muted-foreground">
              Use the native picker, or type into any field below — everything stays in sync.
            </p>
          </div>

          <div>
            <p className="mb-2 text-sm font-medium">Presets</p>
            <div className="flex flex-wrap gap-2">
              {PRESET_SWATCHES.map((swatch) => {
                const selected = swatch.toUpperCase() === hex
                return (
                  <button
                    key={swatch}
                    type="button"
                    title={swatch}
                    onClick={() => setRgb(hexToRgb(swatch))}
                    className="size-7 rounded-full border-2"
                    style={{
                      backgroundColor: swatch,
                      borderColor: selected ? 'var(--primary)' : 'var(--border)',
                    }}
                  />
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="hex-field">Hex</Label>
            <Input id="hex-field" value={hex} onChange={(e) => applyHex(e.target.value)} placeholder="#RRGGBB" />
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">RGB</p>
            <div className="grid grid-cols-3 gap-2.5">
              <Input
                aria-label="R"
                type="number"
                min={0}
                max={255}
                value={rgb.r}
                onChange={(e) => applyRgbField({ r: Number(e.target.value) })}
              />
              <Input
                aria-label="G"
                type="number"
                min={0}
                max={255}
                value={rgb.g}
                onChange={(e) => applyRgbField({ g: Number(e.target.value) })}
              />
              <Input
                aria-label="B"
                type="number"
                min={0}
                max={255}
                value={rgb.b}
                onChange={(e) => applyRgbField({ b: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium">HSL</p>
            <div className="grid grid-cols-3 gap-2.5">
              <Input
                aria-label="H°"
                type="number"
                value={Math.round(hsl.h)}
                onChange={(e) => applyHslField({ h: Number(e.target.value) })}
              />
              <Input
                aria-label="S%"
                type="number"
                min={0}
                max={100}
                value={Math.round(hsl.s)}
                onChange={(e) => applyHslField({ s: Number(e.target.value) })}
              />
              <Input
                aria-label="L%"
                type="number"
                min={0}
                max={100}
                value={Math.round(hsl.l)}
                onChange={(e) => applyHslField({ l: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      }
      outputPanel={
        <div>
          <p className="text-sm font-medium">Color-blindness simulation</p>
          <p className="mt-1 text-sm text-muted-foreground">
            How this color would appear under each common form of color vision deficiency, compared to the
            original.
          </p>
          <div className="mt-4 flex flex-wrap gap-4">
            <SwatchCard label="Original" hex={hex} />
            {COLOR_BLINDNESS_TYPES.map((type) => (
              <SwatchCard key={type} label={CVD_LABELS[type]} hex={rgbToHex(simulated[type])} />
            ))}
          </div>
        </div>
      }
    />
  )
}

function SwatchCard({ label, hex }: { label: string; hex: string }) {
  return (
    <div className="w-[150px] rounded-xl border border-border bg-card p-3">
      <div className="h-16 rounded-lg border border-border" style={{ backgroundColor: hex }} />
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className="font-mono text-xs text-muted-foreground">{hex}</p>
    </div>
  )
}
