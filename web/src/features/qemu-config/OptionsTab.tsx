import { useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  Bot,
  CalendarClock,
  Clock,
  Cpu,
  FileCode,
  Fingerprint,
  Keyboard,
  ListOrdered,
  Lock,
  MonitorPlay,
  MousePointer2,
  Plug,
  Power,
  Save,
  ShieldHalf,
  Snowflake,
  Tag,
  Zap,
  type LucideIcon,
} from 'lucide-react'

import { useQemuPending } from '@/api/qemu-config'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { GuestTabProps } from '@/features/guest/types'
import { errorMessage } from '@/lib/errors'
import { toast } from 'sonner'

import {
  QemuConfigProvider,
  useDialogHost,
  useQemuConfig,
  useQemuConfigValue,
  useRevert,
  useSaveConfig,
  type DialogRenderProps,
} from './context'
import {
  AgentDialog,
  BootOrderDialog,
  HookscriptDialog,
  HotplugDialog,
  KeyboardDialog,
  LocaltimeDialog,
  NameDialog,
  OsTypeDialog,
  SevDialog,
  SmbiosDialog,
  SpiceDialog,
  StartDateDialog,
  StartupDialog,
  TdxDialog,
  VmStateStorageDialog,
} from './editors/options'
import { splitPending } from './model'
import { OPTION_GROUP_LABEL, optionRows, type OptionKey, type OptionRow } from './options-model'
import { ConfigRow, ConfigSection, ConfigSkeleton, PendingBanner, type RowAction } from './ui'

const ICON: Record<OptionKey, LucideIcon> = {
  name: Tag,
  onboot: Power,
  startup: ListOrdered,
  ostype: Cpu,
  boot: ListOrdered,
  tablet: MousePointer2,
  hotplug: Plug,
  acpi: Zap,
  kvm: Activity,
  freeze: Snowflake,
  localtime: Clock,
  startdate: CalendarClock,
  smbios1: Fingerprint,
  agent: Bot,
  protection: Lock,
  spice_enhancements: MonitorPlay,
  vmstatestorage: Save,
  keyboard: Keyboard,
  'amd-sev': ShieldHalf,
  'intel-tdx': ShieldHalf,
  hookscript: FileCode,
}

const TOGGLE_HINT: Partial<Record<OptionKey, string>> = {
  onboot: '节点开机时自动启动',
  protection: '防止误删虚拟机及其磁盘',
  freeze: '启动后暂停，等待手动继续（调试用）',
  tablet: '让鼠标指针与 VNC 同步',
  acpi: '电源按钮、正常关机需要它',
  kvm: '关闭后使用纯软件模拟，非常慢',
}

/** /guest/:node/qemu/:vmid/options */
export default function OptionsTab({ node, vmid, guest }: GuestTabProps) {
  const pending = useQemuPending(node, vmid)
  const state = useMemo(() => splitPending(pending.data), [pending.data])
  const ctx = useQemuConfigValue(node, vmid, guest, state)
  if (pending.isPending) return <ConfigSkeleton />
  if (pending.isError && !pending.data) {
    return (
      <GlassCard>
        <EmptyState
          icon={Lock}
          title="无法加载选项"
          description={pending.error.message}
          action={
            <Button variant="outline" onClick={() => void pending.refetch()}>
              重试
            </Button>
          }
        />
      </GlassCard>
    )
  }
  return (
    <QemuConfigProvider value={ctx}>
      <OptionsView />
    </QemuConfigProvider>
  )
}

function OptionsView() {
  const { state, guest, can, isRoot, running } = useQemuConfig()
  const rows = useMemo(() => optionRows(state, guest.name), [state, guest.name])
  const { show, host } = useDialogHost()
  const revert = useRevert()
  const pendingRows = rows.filter((r) => r.status !== 'unchanged')

  const editor = (key: OptionKey): ((p: DialogRenderProps) => ReactNode) | null => {
    const opts = can('VM.Config.Options')
    const hw = can('VM.Config.HWType')
    switch (key) {
      case 'name':
        return opts ? (p) => <NameDialog {...p} /> : null
      case 'startup':
        return opts && can('Sys.Modify', 'nodes') ? (p) => <StartupDialog {...p} /> : null
      case 'ostype':
        return opts ? (p) => <OsTypeDialog {...p} /> : null
      case 'boot':
        return can('VM.Config.Disk') ? (p) => <BootOrderDialog {...p} /> : null
      case 'hotplug':
        return hw ? (p) => <HotplugDialog {...p} /> : null
      case 'localtime':
        return opts ? (p) => <LocaltimeDialog {...p} /> : null
      case 'startdate':
        return opts ? (p) => <StartDateDialog {...p} /> : null
      case 'keyboard':
        return opts ? (p) => <KeyboardDialog {...p} /> : null
      case 'smbios1':
        return hw ? (p) => <SmbiosDialog {...p} /> : null
      case 'agent':
        return opts ? (p) => <AgentDialog {...p} /> : null
      case 'spice_enhancements':
        return opts ? (p) => <SpiceDialog {...p} /> : null
      case 'vmstatestorage':
        return opts ? (p) => <VmStateStorageDialog {...p} /> : null
      case 'amd-sev':
        return hw ? (p) => <SevDialog {...p} /> : null
      case 'intel-tdx':
        return hw ? (p) => <TdxDialog {...p} /> : null
      case 'hookscript':
        return isRoot ? (p) => <HookscriptDialog {...p} /> : null
      default:
        return null
    }
  }

  const groups = (['general', 'boot', 'hardware', 'advanced'] as const).map((g) => ({ g, rows: rows.filter((r) => r.group === g) }))

  return (
    <div className="grid gap-5">
      <PendingBanner
        count={pendingRows.length}
        running={running}
        onRevertAll={() =>
          show((p) => (
            <ConfirmDialog
              {...p}
              title="撤销全部未生效的更改？"
              description={`${pendingRows.length} 项选项的更改会被丢弃。`}
              confirmLabel="全部撤销"
              onConfirm={() => revert([...new Set(pendingRows.flatMap((r) => r.keys ?? [r.key]))], '撤销未生效的选项更改')}
            />
          ))
        }
      />
      {groups.map(({ g, rows: list }) => (
        <ConfigSection key={g} title={OPTION_GROUP_LABEL[g]}>
          {list.map((row) =>
            row.toggle ? (
              <ToggleRow key={row.key} row={row} />
            ) : (
              <OptionConfigRow key={row.key} row={row} edit={editor(row.key)} show={show} />
            ),
          )}
        </ConfigSection>
      ))}
      {host}
    </div>
  )
}

function revertAction(row: OptionRow, revert: ReturnType<typeof useRevert>): RowAction[] {
  if (row.status === 'unchanged') return []
  return [
    {
      id: 'revert',
      label: '撤销未生效的更改',
      onSelect: () => void revert(row.keys ?? [row.key], `撤销 ${row.title}`).catch((e: unknown) => toast.error(errorMessage(e))),
    },
  ]
}

function OptionConfigRow({
  row,
  edit,
  show,
}: {
  row: OptionRow
  edit: ((p: DialogRenderProps) => ReactNode) | null
  show: (r: (p: DialogRenderProps) => ReactNode) => void
}) {
  const revert = useRevert()
  const extra = revertAction(row, revert)
  const actions: RowAction[] = extra.length && edit ? [{ id: 'edit', label: '编辑', onSelect: () => show(edit) }, ...extra] : extra
  return (
    <ConfigRow
      testId={`opt-${row.key}`}
      icon={ICON[row.key]}
      title={row.title}
      summary={row.summary}
      pendingSummary={row.pendingSummary}
      status={row.status}
      mono={row.key === 'hookscript' || row.key === 'startdate'}
      onOpen={edit ? () => show(edit) : undefined}
      openLabel={`编辑${row.title}`}
      actions={actions}
    />
  )
}

/** Boolean option with an inline switch (saves right away). */
function ToggleRow({ row }: { row: OptionRow }) {
  const { cfg, can } = useQemuConfig()
  const save = useSaveConfig()
  const revert = useRevert()
  const [busy, setBusy] = useState(false)
  const def = row.toggle!.default
  const raw = cfg[row.key]
  const checked = raw === undefined ? def : raw === '1'
  const perm =
    row.key === 'freeze' ? can('VM.PowerMgmt') : row.key === 'tablet' || row.key === 'acpi' || row.key === 'kvm' ? can('VM.Config.HWType') : can('VM.Config.Options')
  const pending = row.status !== 'unchanged'

  const toggle = async (on: boolean) => {
    setBusy(true)
    try {
      // Default values are deleted rather than written (deleteDefaultValue).
      const value = on === def ? '' : on ? '1' : '0'
      await save(
        // No digest: a single boolean, and quick consecutive toggles would race the refetch.
        value === '' ? { delete: row.key } : { [row.key]: value },
        { title: `${on ? '启用' : '关闭'}${row.title}`, message: `${row.title}：已${on ? '启用' : '关闭'}` },
      )
    } catch (e) {
      toast.error(`修改${row.title}失败`, { description: errorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex min-h-16 items-center gap-3 px-(--card-p) py-(--row-py) compact:min-h-13">
      <span
        aria-hidden
        className={
          pending
            ? 'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning-strong ring-1 ring-warning/20 ring-inset'
            : 'inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand-strong ring-1 ring-brand/15 ring-inset paper:bg-secondary paper:text-foreground/75 paper:ring-border'
        }
      >
        {(() => {
          const Icon = ICON[row.key]
          return <Icon className="size-[18px]" />
        })()}
      </span>
      <label htmlFor={`opt-switch-${row.key}`} className="grid min-w-0 flex-1 cursor-pointer gap-0.5">
        <span className="font-medium">{row.title}</span>
        <span className="text-[13px] leading-snug text-muted-foreground">
          {pending ? <span className="text-warning-strong">已修改，{row.pendingSummary ? `重启后为“${row.pendingSummary}”` : '待生效'}</span> : TOGGLE_HINT[row.key]}
        </span>
      </label>
      {pending && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground"
          onClick={() => void revert(row.keys ?? [row.key], `撤销 ${row.title}`).catch((e: unknown) => toast.error(errorMessage(e)))}
        >
          撤销
        </Button>
      )}
      <Switch
        id={`opt-switch-${row.key}`}
        data-testid={`opt-${row.key}`}
        checked={checked}
        disabled={busy || !perm}
        onCheckedChange={(on) => void toggle(on)}
        aria-label={row.title}
      />
    </li>
  )
}
