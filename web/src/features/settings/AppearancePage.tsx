import { useId, type ReactNode } from 'react'
import { Check } from 'lucide-react'

import { GlassCard } from '@/components/GlassCard'
import { PageHeader, SectionHeader } from '@/components/PageHeader'
import { StatusDot } from '@/components/StatusDot'
import { UsageBar } from '@/components/UsageBar'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { DENSITY_LABEL, THEME_MODE_META } from '@/theme/meta'
import { ACCENT_SWATCHES, swatchColor } from '@/theme/palette'
import { ACCENTS, DENSITIES, THEME_MODES, type Density, type ThemeMode } from '@/theme/prefs'
import { useTheme } from '@/theme/ThemeProvider'

import { AppSettings } from './AppSettings'

/** Static colours for the mini previews (independent of the active theme). */
const PREVIEW: Record<Exclude<ThemeMode, 'system'>, { bg: string; card: string; text: string; line: string; glow?: string }> = {
  dark: { bg: '#07080a', card: 'rgba(255,255,255,.07)', text: '#ececef', line: 'rgba(255,255,255,.14)', glow: 'rgba(139,147,255,.45)' },
  light: { bg: '#eceef3', card: 'rgba(255,255,255,.85)', text: '#111318', line: 'rgba(17,24,39,.12)', glow: 'rgba(79,70,229,.25)' },
  paper: { bg: '#faf9f5', card: '#fffefb', text: '#141413', line: '#e6e2d6' },
}

function MiniPreview({ mode }: { mode: Exclude<ThemeMode, 'system'> }) {
  const c = PREVIEW[mode]
  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: c.bg }}>
      {c.glow && (
        <div
          className="absolute -top-6 -left-6 size-20 rounded-full blur-xl"
          style={{ background: c.glow }}
          aria-hidden
        />
      )}
      <div
        className="absolute inset-x-3 top-3 rounded-md p-2"
        style={{ background: c.card, border: `1px solid ${c.line}` }}
      >
        <div
          className="h-1.5 w-2/5 rounded-full"
          style={{ background: c.text, opacity: 0.85, ...(mode === 'paper' ? { borderRadius: 1 } : {}) }}
        />
        <div className="mt-1.5 h-1 w-3/5 rounded-full" style={{ background: c.text, opacity: 0.25 }} />
        <div className="mt-2 h-1 rounded-full" style={{ background: c.line }}>
          <div className="h-1 w-3/5 rounded-full" style={{ background: mode === 'paper' ? '#d97757' : mode === 'dark' ? '#8b93ff' : '#4f46e5' }} />
        </div>
      </div>
    </div>
  )
}

function ThemeOption({ mode, selected, onSelect }: { mode: ThemeMode; selected: boolean; onSelect: () => void }) {
  const meta = THEME_MODE_META[mode]
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-brand ring-1 ring-brand' : 'border-border hover:border-foreground/20',
      )}
    >
      <div className="aspect-[16/9] w-full border-b border-border">
        {mode === 'system' ? (
          <div className="grid h-full grid-cols-2">
            <MiniPreview mode="dark" />
            <MiniPreview mode="light" />
          </div>
        ) : (
          <MiniPreview mode={mode} />
        )}
      </div>
      <div className="flex items-start gap-2 p-3">
        <meta.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{meta.label}</div>
          <div className="text-xs text-muted-foreground">{meta.description}</div>
        </div>
        {selected && (
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-primary-foreground">
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </div>
    </button>
  )
}

function SettingRow({
  title,
  description,
  control,
  htmlFor,
  disabled,
}: {
  title: string
  description?: string
  control: ReactNode
  htmlFor?: string
  disabled?: boolean
}) {
  return (
    <div className={cn('flex items-center gap-4 py-(--row-py)', disabled && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-sm font-medium">
          {title}
        </label>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function AppearancePage() {
  const { prefs, resolved, setPrefs } = useTheme()
  const paper = resolved === 'paper'
  const glassId = useId()

  return (
    <>
      <PageHeader title="外观与偏好" description="这些偏好只保存在当前设备上" backTo="/" />

      <div className="grid gap-(--section-gap)">
        <section>
          <SectionHeader title="主题" />
          <div role="radiogroup" aria-label="主题" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {THEME_MODES.map((m) => (
              <ThemeOption key={m} mode={m} selected={prefs.mode === m} onSelect={() => setPrefs({ mode: m })} />
            ))}
          </div>
        </section>

        <section>
          <SectionHeader title="强调色" />
          <GlassCard>
            <div role="radiogroup" aria-label="强调色" className="flex flex-wrap gap-3">
              {ACCENTS.map((a) => {
                const selected = !paper && prefs.accent === a
                return (
                  <button
                    key={a}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={paper}
                    onClick={() => setPrefs({ accent: a })}
                    className="group flex flex-col items-center gap-1.5 outline-none disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    <span
                      className={cn(
                        'inline-flex size-11 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition-all group-focus-visible:ring-2 group-focus-visible:ring-ring',
                        selected && 'ring-2 ring-foreground/70',
                      )}
                      style={{ background: swatchColor(a, resolved === 'paper' ? 'dark' : resolved) }}
                    >
                      {selected && (
                        <Check className="size-4" style={{ color: resolved === 'dark' ? '#0a0b14' : '#ffffff' }} strokeWidth={3} />
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">{ACCENT_SWATCHES[a].label}</span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {paper ? '纸质主题固定使用 Clay 强调色。' : '暗色主题使用亮色档，浅色主题使用深色档，保证文字对比度。'}
            </p>
          </GlassCard>
        </section>

        <section>
          <SectionHeader title="显示" />
          <GlassCard className="divide-y divide-border/70 py-1">
            <SettingRow
              title="玻璃质感"
              description={paper ? '纸质主题始终使用实色卡片。' : '关闭后卡片改为实色、去掉模糊效果，适合旧手机。'}
              htmlFor={glassId}
              disabled={paper}
              control={
                <Switch
                  id={glassId}
                  checked={!paper && prefs.glass}
                  disabled={paper}
                  onCheckedChange={(v) => setPrefs({ glass: v })}
                />
              }
            />
            <SettingRow
              title="列表密度"
              description="紧凑模式下每屏显示更多行。"
              control={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={prefs.density}
                  onValueChange={(v) => v && setPrefs({ density: v as Density })}
                  aria-label="列表密度"
                >
                  {DENSITIES.map((d) => (
                    <ToggleGroupItem key={d} value={d} className="px-3 text-xs">
                      {DENSITY_LABEL[d]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              }
            />
          </GlassCard>
        </section>

        <AppSettings />

        <section>
          <SectionHeader title="预览" />
          <GlassCard>
            <div className="flex items-center gap-3">
              <StatusDot status="running" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">web-01</div>
                <div className="text-xs text-muted-foreground">
                  <span className="tabular">101</span> · 虚拟机
                </div>
              </div>
              <Button size="sm">启动</Button>
              <Button size="sm" variant="outline">
                控制台
              </Button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <UsageBar label="CPU" value={0.32} detail="4 核" />
              <UsageBar label="内存" value={0.81} detail="6.5 / 8.0 GiB" />
            </div>
          </GlassCard>
        </section>
      </div>
    </>
  )
}
