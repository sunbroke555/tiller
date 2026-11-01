import { useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { toast } from 'sonner'

import { GlassCard } from '@/components/GlassCard'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { dismissInstall, installDismissed, useInstallPrompt } from '@/hooks/usePwa'
import { cn } from '@/lib/utils'

/**
 * "Add to home screen" card for phones: the browser's install prompt on
 * Android/Chromium, short share-sheet instructions on iOS Safari. Hidden when
 * already installed, unavailable (plain HTTP) or dismissed in the last 30 days.
 */
export function InstallBanner({ className, force }: { className?: string; force?: boolean }) {
  const { state, install } = useInstallPrompt()
  const [hidden, setHidden] = useState(() => !force && installDismissed())
  if (hidden || (state !== 'available' && state !== 'ios')) return null

  const dismiss = () => {
    dismissInstall()
    setHidden(true)
  }

  return (
    <GlassCard className={cn('relative flex items-start gap-3.5 lg:hidden', className)} role="region" aria-label="安装应用">
      <Logo className="size-11 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 pr-6">
        <div className="font-medium">把 PVE Web 添加到主屏幕</div>
        {state === 'available' ? (
          <p className="mt-0.5 text-sm text-muted-foreground">像应用一样全屏打开，启动更快。</p>
        ) : (
          <p className="mt-0.5 text-sm text-muted-foreground">
            点按 Safari 底部的 <Share className="inline size-4 -translate-y-px" aria-label="分享" />，再选择
            <span className="whitespace-nowrap">
              「添加到主屏幕」
              <SquarePlus className="ml-0.5 inline size-4 -translate-y-px" aria-hidden />
            </span>
          </p>
        )}
        {state === 'available' && (
          <Button
            size="sm"
            className="mt-3 pointer-coarse:h-11"
            onClick={() =>
              void install().then((ok) => {
                if (ok) {
                  toast.success('已安装到主屏幕')
                  setHidden(true)
                }
              })
            }
          >
            <Download /> 安装
          </Button>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="不再提示"
        className="absolute top-1.5 right-1.5 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11"
      >
        <X className="size-4" />
      </button>
    </GlassCard>
  )
}
