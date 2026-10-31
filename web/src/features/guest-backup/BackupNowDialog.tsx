import { useEffect, useRef, useState } from 'react'
import { Pause, Power, Zap } from 'lucide-react'

import { startBackup, useBackupStorages, useVzdumpDefaults } from '@/api/guest-backup'
import type { GuestType } from '@/api/types'
import { FieldInput, FieldTextarea, FormDialog, FormField, FormRow, FormSection, SelectField, StorageSelect, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'

import {
  NOTES_TEMPLATE_VARS,
  describeRetention,
  notificationModeFromDefaults,
  parseRetention,
  unescapeNotesTemplate,
  vzdumpParams,
  type BackupCompress,
  type BackupMode,
  type NotificationMode,
  type PbsChangeDetection,
} from './logic'
import { ChoiceCards, Notice } from './ui'

export interface BackupNowDialogProps {
  node: string
  type: GuestType
  vmid: number
  /** Display name. */
  name: string
  /** Preselected storage (e.g. the one filtered in the backup list). */
  storage?: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}

const VAR_LABEL: Record<(typeof NOTES_TEMPLATE_VARS)[number], string> = {
  guestname: '客户机名称',
  vmid: 'VMID',
  node: '节点',
  cluster: '集群',
}

/** "立即备份": one-off vzdump of this guest (POST /nodes/{node}/vzdump). */
export function BackupNowDialog({ node, type, vmid, name, storage: initialStorage, open, onOpenChange }: BackupNowDialogProps) {
  const storages = useBackupStorages(open ? node : null)
  const [storage, setStorage] = useState<string | undefined>(initialStorage)
  const [mode, setMode] = useState<BackupMode>('snapshot')
  const [compress, setCompress] = useState<BackupCompress>('zstd')
  const [protect, setProtect] = useState(false)
  const [notes, setNotes] = useState('{{guestname}}')
  const [notification, setNotification] = useState<NotificationMode>('notification-system')
  const [mailto, setMailto] = useState('')
  const [prune, setPrune] = useState(false)
  const [pbsMode, setPbsMode] = useState<PbsChangeDetection | undefined>(undefined)
  const initialized = useRef(false)
  const notesRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setStorage(initialStorage)
      setMode('snapshot')
      setCompress('zstd')
      setProtect(false)
      setNotes('{{guestname}}')
      setNotification('notification-system')
      setMailto('')
      setPrune(false)
      setPbsMode(undefined)
      initialized.current = false
    }
  }, [open, initialStorage])

  const defaults = useVzdumpDefaults(node, open ? storage : null)
  const selected = storages.data?.find((s) => s.storage === storage)
  const pbs = selected?.type === 'pbs'
  const retention = parseRetention(defaults.data?.['prune-backups'])
  const canPrune = !!retention && !retention.keepAll && retention.keeps.length > 0

  // First defaults (like the official dialog): mode, notes template, notification.
  useEffect(() => {
    const d = defaults.data
    if (!open || !d || initialized.current) return
    initialized.current = true
    if (d.mode) setMode(d.mode)
    if (d['notes-template']) setNotes(unescapeNotesTemplate(d['notes-template']))
    setNotification(notificationModeFromDefaults(d))
    if (d.mailto) setMailto(d.mailto)
  }, [defaults.data, open])

  useEffect(() => {
    if (!canPrune) setPrune(false)
  }, [canPrune])

  const insertVar = (v: string) => {
    const token = `{{${v}}}`
    const el = notesRef.current
    if (!el) return setNotes((n) => n + token)
    const start = el.selectionStart ?? notes.length
    const end = el.selectionEnd ?? notes.length
    const next = notes.slice(0, start) + token + notes.slice(end)
    setNotes(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="立即备份"
      description={`${type === 'qemu' ? '虚拟机' : '容器'} ${name}（${vmid}）`}
      submitLabel="开始备份"
      submitDisabled={!storage}
      onSubmit={async () => {
        if (!storage) throw new Error('请选择备份存储')
        const params = vzdumpParams(
          vmid,
          { storage, mode, compress, protected: protect, notesTemplate: notes, notificationMode: notification, mailto, prune, pbsChangeDetection: pbsMode },
          { type, pbs },
        )
        await runTask(startBackup(node, params), { title: `备份 ${name} 到 ${storage}` })
      }}
    >
      <FormField label="存储" name="storage" required>
        <StorageSelect node={node} content="backup" value={storage} onValueChange={setStorage} />
      </FormField>

      <FormField label="模式" name="mode">
        <ChoiceCards
          aria-label="备份模式"
          value={mode}
          onValueChange={setMode}
          columns={3}
          dense
          options={[
            { value: 'snapshot', label: '快照', icon: <Zap />, description: '不停机，大多数情况的首选' },
            { value: 'suspend', label: '挂起', icon: <Pause />, description: type === 'qemu' ? '短暂暂停，一致性更好' : '短暂冻结容器' },
            { value: 'stop', label: '停止', icon: <Power />, description: '备份期间关机，一致性最好' },
          ]}
        />
      </FormField>

      <FormRow>
        <FormField label="压缩" name="compress" hint={pbs ? 'Proxmox Backup Server 固定使用 ZSTD' : undefined}>
          <SelectField
            value={pbs ? 'zstd' : compress}
            onValueChange={(v) => setCompress((v as BackupCompress | undefined) ?? 'zstd')}
            disabled={pbs}
            options={[
              { value: 'zstd', label: 'ZSTD', description: '又快又好' },
              { value: 'lzo', label: 'LZO', description: '最快' },
              { value: 'gzip', label: 'GZIP', description: '压缩率高' },
              { value: '0', label: '不压缩' },
            ]}
          />
        </FormField>
        {pbs && type === 'lxc' ? (
          <FormField label="PBS 变更检测" name="pbs-change-detection-mode" hint="检测文件变化的方式，影响容器备份速度">
            <SelectField
              value={pbsMode}
              onValueChange={(v) => setPbsMode(v as PbsChangeDetection | undefined)}
              emptyOption="默认"
              options={[
                { value: 'legacy', label: 'Legacy', description: '读取全部数据' },
                { value: 'data', label: 'Data', description: '新格式，读取全部数据' },
                { value: 'metadata', label: 'Metadata', description: '只读元数据，最快' },
              ]}
            />
          </FormField>
        ) : (
          <div className="flex items-end">
            <SwitchField label="受保护" description="防止被清理或误删" checked={protect} onCheckedChange={setProtect} className="w-full" />
          </div>
        )}
      </FormRow>
      {pbs && type === 'lxc' && <SwitchField label="受保护" description="防止被清理或误删" checked={protect} onCheckedChange={setProtect} />}

      <FormField
        label="备注"
        name="notes-template"
        hint={
          <span className="flex flex-wrap items-center gap-1.5">
            <span>插入变量：</span>
            {NOTES_TEMPLATE_VARS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                className="inline-flex h-7 items-center rounded-md border border-border bg-secondary px-2 font-mono text-[11px] text-secondary-foreground transition-colors hover:bg-accent pointer-coarse:h-9"
                title={VAR_LABEL[v]}
              >
                {`{{${v}}}`}
              </button>
            ))}
          </span>
        }
      >
        <FieldTextarea ref={notesRef} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-16 font-mono text-sm" />
      </FormField>

      {canPrune && (
        <div className="grid gap-2">
          <SwitchField
            label="备份后清理旧备份"
            description={`按存储 ${storage} 的保留策略：${describeRetention(retention)}`}
            checked={prune}
            onCheckedChange={setPrune}
          />
          {prune && <Notice tone="warning">超出保留策略的旧备份会被删除（受保护的备份除外）。</Notice>}
        </div>
      )}

      <FormSection collapsible title="通知">
        <FormField label="通知方式" name="notification-mode">
          <SelectField
            value={notification}
            onValueChange={(v) => setNotification((v as NotificationMode | undefined) ?? 'notification-system')}
            options={[
              { value: 'notification-system', label: '使用全局通知设置' },
              { value: 'legacy-sendmail', label: '使用 sendmail（旧版）' },
            ]}
          />
        </FormField>
        {notification === 'legacy-sendmail' && (
          <FormField label="发送邮件到" name="mailto" hint="多个地址用逗号分隔">
            <FieldInput value={mailto} onChange={(e) => setMailto(e.target.value)} type="email" inputMode="email" placeholder="admin@example.com" />
          </FormField>
        )}
      </FormSection>
    </FormDialog>
  )
}

export default BackupNowDialog
