import { useState, type ReactNode } from 'react'
import { Database, Download, Keyboard, Languages, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { useClusterOptions } from '@/api/shell'
import { instanceStorageKey } from '@/api/instance-scope'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { GlassCard } from '@/components/GlassCard'
import { openShortcutsHelp } from '@/components/layout/KeyboardShortcuts'
import { SectionHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { COUNTED_STORAGES_KEY, useCountedStorages } from '@/features/datacenter/countedStorages'
import { CountedStoragesDialog } from '@/features/datacenter/CountedStoragesDialog'
import { isIosSafari, useInstallPrompt } from '@/hooks/usePwa'

/** PVE language codes of the datacenter default (Datacenter → Options → Language). */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  zh_CN: '简体中文',
  zh_TW: '繁體中文',
  de: 'Deutsch',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  es: 'Español',
  it: 'Italiano',
  ru: 'Русский',
  pt_BR: 'Português (Brasil)',
}

/** Local data the "清除本地设置" button removes (never the login session). */
export const LOCAL_SETTING_KEYS = [
  'tiller:appearance',
  instanceStorageKey('tiller:resource-tree'),
  instanceStorageKey('tiller:last-login'),
  instanceStorageKey('tiller:last-tfa-method'),
  'tiller:install-dismissed',
  COUNTED_STORAGES_KEY,
]

function Row({ icon: Icon, title, description, control }: { icon: typeof Download; title: string; description: ReactNode; control?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-(--row-py)">
      <Icon className="size-[18px] shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1 basis-48">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  )
}

/** Install, language, shortcuts and "clear local data" rows of the settings page. */
export function AppSettings() {
  const { state, install } = useInstallPrompt()
  const options = useClusterOptions()
  const [confirm, setConfirm] = useState(false)
  const [pickStorages, setPickStorages] = useState(false)
  const [counted] = useCountedStorages()
  const dcLang = typeof options.data?.language === 'string' ? options.data.language : undefined

  const installDescription =
    state === 'installed'
      ? '已作为应用安装在这台设备上。'
      : state === 'available'
        ? '安装后可以从主屏幕或程序坞全屏打开。'
        : state === 'ios' || isIosSafari()
          ? '在 Safari 中点按“分享”，再选“添加到主屏幕”。'
          : '需要通过 HTTPS 访问（或浏览器暂不支持安装）。'

  return (
    <section>
      <SectionHeader title="应用" />
      <GlassCard className="divide-y divide-border/70 py-1">
        <Row
          icon={Download}
          title="安装到设备"
          description={installDescription}
          control={
            state === 'available' && (
              <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => void install()}>
                安装
              </Button>
            )
          }
        />
        <Row
          icon={Languages}
          title="界面语言"
          description={
            <>
              Tiller 只提供简体中文界面，任务日志和错误信息保持 PVE 原文。
              {dcLang && <> 数据中心默认语言：{LANGUAGE_NAMES[dcLang] ?? dcLang}（只影响官方界面）。</>}
            </>
          }
          control={<span className="text-sm text-muted-foreground">简体中文</span>}
        />
        <Row
          icon={Keyboard}
          title="键盘快捷键"
          description="在任意页面按 ? 查看，G 加字母快速跳转。"
          control={
            <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => openShortcutsHelp()}>
              查看
            </Button>
          }
        />
        <Row
          icon={Database}
          title="数据中心存储统计"
          description={counted.length ? '只统计你选中的存储。' : '统计所有可用存储，共享存储只算一次。'}
          control={
            <Button size="sm" variant="outline" onClick={() => setPickStorages(true)}>
              选择存储
            </Button>
          }
        />
        <Row
          icon={Trash2}
          title="清除本地设置"
          description="恢复默认外观、资源树分组、存储统计和记住的用户名，不会退出登录。"
          control={
            <Button size="sm" variant="outline" className="pointer-coarse:h-11" onClick={() => setConfirm(true)}>
              清除
            </Button>
          }
        />
      </GlassCard>
      <CountedStoragesDialog open={pickStorages} onOpenChange={setPickStorages} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="清除这台设备上的本地设置？"
        description="主题、强调色、列表密度、资源树分组和记住的用户名都会恢复默认。"
        confirmLabel="清除"
        destructive
        onConfirm={() => {
          for (const k of LOCAL_SETTING_KEYS) {
            try {
              localStorage.removeItem(k)
            } catch {
              // ignore
            }
          }
          toast.success('已清除本地设置')
          // Re-read every preference from scratch.
          setTimeout(() => window.location.reload(), 400)
        }}
      />
    </section>
  )
}
