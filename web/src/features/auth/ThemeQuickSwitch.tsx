import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { THEME_MODE_META } from '@/theme/meta'
import { THEME_MODES, type ThemeMode } from '@/theme/prefs'
import { useTheme } from '@/theme/ThemeProvider'

/** Compact theme picker for pages without the full settings (login). */
export function ThemeQuickSwitch() {
  const { prefs, setPrefs } = useTheme()
  const Icon = THEME_MODE_META[prefs.mode].icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="切换主题">
          <Icon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup value={prefs.mode} onValueChange={(v) => setPrefs({ mode: v as ThemeMode })}>
          {THEME_MODES.map((m) => {
            const MIcon = THEME_MODE_META[m].icon
            return (
              <DropdownMenuRadioItem key={m} value={m}>
                <MIcon className="text-muted-foreground" />
                {THEME_MODE_META[m].label}
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
