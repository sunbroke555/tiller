import { useEffect, useState } from 'react'
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui'
import { toast } from 'sonner'

import { cloneGuest, useGuestFeature, useGuestSnapshots, usePools } from '@/api/guest-lifecycle'
import { useNodeStorages } from '@/api/queries'
import {
  FieldInput,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  SelectField,
  StorageSelect,
  VmidInput,
  type VmidValidity,
} from '@/components/form'
import type { ActionDialogProps } from '@/components/page/registry'
import { runTask } from '@/components/tasks/tracker'
import type { GuestActionContext } from '@/features/guest/types'
import { formatDateTime } from '@/lib/format'
import { guestPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

import { Notice } from './notes'
import { cloneParams, FILE_STORAGE_TYPES, nameError } from './params'

const FORMATS = [
  { value: 'raw', label: 'Raw', description: '性能最好' },
  { value: 'qcow2', label: 'QCOW2', description: '支持快照、精简' },
  { value: 'vmdk', label: 'VMDK', description: 'VMware 格式' },
]

/** Clone a guest or template: new ID, name, target node, linked/full, storage, pool, snapshot. */
export default function CloneDialog({ ctx, open, onOpenChange }: ActionDialogProps<GuestActionContext>) {
  const { node, type, vmid, guest, name, navigate } = ctx
  const isTemplate = guest.template === 1
  const [newid, setNewid] = useState<number | undefined>()
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [newName, setNewName] = useState('')
  const [target, setTarget] = useState<string | undefined>(node)
  const [full, setFull] = useState(!isTemplate)
  const [storage, setStorage] = useState<string | undefined>()
  const [format, setFormat] = useState<string | undefined>()
  const [pool, setPool] = useState<string | undefined>()
  const [snapname, setSnapname] = useState<string>('current')
  const [bwlimit, setBwlimit] = useState<number | undefined>()

  useEffect(() => {
    if (open) {
      setNewid(undefined)
      setNewName(guest.name ? `${guest.name}-clone` : '')
      setTarget(node)
      setFull(!isTemplate)
      setStorage(undefined)
      setFormat(undefined)
      setPool(undefined)
      setSnapname('current')
      setBwlimit(undefined)
    }
  }, [open])

  const snapshots = useGuestSnapshots(node, type, vmid, { enabled: open && !isTemplate })
  const snapList = (snapshots.data ?? []).filter((s) => s.name !== 'current')
  const pools = usePools({ enabled: open })
  const feature = useGuestFeature(node, type, vmid, full ? 'copy' : 'clone', snapname, { enabled: open })
  const allowedNodes = feature.data?.nodes
  const { data: storages } = useNodeStorages(target, type === 'qemu' ? 'images' : 'rootdir', { enabled: open && !!target })
  const storageType = storages?.find((s) => s.storage === storage)?.type
  const fileStorage = !!storageType && (FILE_STORAGE_TYPES as readonly string[]).includes(storageType)
  useEffect(() => {
    if (!fileStorage) setFormat(undefined)
  }, [fileStorage])

  const unsupported = feature.data && !feature.data.hasFeature
  const badName = nameError(newName)
  const targetNotAllowed = !!target && !!allowedNodes && !allowedNodes.includes(target)
  const canSubmit = !!newid && validity === 'free' && !badName && !!target && !targetNotAllowed && !unsupported

  const submit = async () => {
    const params = cloneParams(
      type,
      { newid: newid!, name: newName, target, full, storage, format, pool, snapname, bwlimit },
      { sourceNode: node, isTemplate },
    )
    const dest = { node: target ?? node, type, vmid: newid! }
    return runTask(cloneGuest(node, type, vmid, params), {
      title: `克隆 ${name} → ${newid}`,
      onSuccess: () =>
        toast.success(`已克隆为 ${type === 'qemu' ? 'VM' : 'CT'} ${dest.vmid}`, {
          action: { label: '打开', onClick: () => navigate(guestPath(dest)) },
        }),
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`克隆 ${name}`}
      description={isTemplate ? '从模板创建新的客户机。' : '完整复制这台客户机的配置和磁盘。'}
      size="lg"
      submitLabel="克隆"
      submitDisabled={!canSubmit}
      onSubmit={submit}
    >
      {isTemplate && (
        <RadioGroupPrimitive.Root
          value={full ? 'full' : 'linked'}
          onValueChange={(v) => setFull(v === 'full')}
          aria-label="克隆方式"
          className="grid gap-2 sm:grid-cols-2"
        >
          <ModeCard value="linked" selected={!full} title="链接克隆" description="与模板共享磁盘，几乎不占空间，创建很快。模板不能再删除。" />
          <ModeCard value="full" selected={full} title="完整克隆" description="复制全部磁盘，和模板互不依赖，占用完整空间。" />
        </RadioGroupPrimitive.Root>
      )}

      {unsupported && (
        <Notice tone="error" title={full ? '无法完整克隆' : '这个模板所在的存储不支持链接克隆'}>
          {full ? '源磁盘所在的存储不支持复制。' : '请改用完整克隆。'}
        </Notice>
      )}

      <FormRow>
        <FormField label={type === 'qemu' ? '新 VM ID' : '新 CT ID'} name="newid" required>
          <VmidInput value={newid} onChange={setNewid} onValidityChange={setValidity} />
        </FormField>
        <FormField label={type === 'qemu' ? '名称' : '主机名'} name={type === 'qemu' ? 'name' : 'hostname'} error={badName ?? undefined}>
          <FieldInput value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="留空则自动命名" autoCapitalize="off" spellCheck={false} />
        </FormField>
      </FormRow>

      <FormRow>
        <FormField
          label="目标节点"
          name="target"
          error={targetNotAllowed ? '磁盘不在共享存储上，只能克隆到源节点' : undefined}
        >
          <NodeSelect value={target} onValueChange={setTarget} />
        </FormField>
        <FormField label="资源池" name="pool">
          <SelectField
            value={pool}
            onValueChange={setPool}
            options={(pools.data ?? []).map((p) => ({ value: p.poolid, label: p.poolid, description: p.comment }))}
            emptyOption="无"
            loading={pools.isPending}
          />
        </FormField>
      </FormRow>

      {!isTemplate && snapList.length > 0 && (
        <FormField label="快照" name="snapname" hint="从某个快照的状态克隆。">
          <SelectField
            value={snapname}
            onValueChange={(v) => setSnapname(v ?? 'current')}
            options={[
              { value: 'current', label: '当前状态' },
              ...snapList.map((s) => ({ value: s.name, label: s.name, description: s.snaptime ? formatDateTime(s.snaptime) : undefined })),
            ]}
          />
        </FormField>
      )}

      {full && (
        <FormRow>
          <FormField label="目标存储" name="storage">
            <StorageSelect
              node={target}
              content={type === 'qemu' ? 'images' : 'rootdir'}
              value={storage}
              onValueChange={setStorage}
              emptyOption="与源磁盘相同"
            />
          </FormField>
          {type === 'qemu' && (
            <FormField label="磁盘格式" name="format" hint={fileStorage ? undefined : '只有目录类存储可以选择格式。'}>
              <SelectField value={format} onValueChange={setFormat} options={FORMATS} emptyOption="与源相同" disabled={!fileStorage} />
            </FormField>
          )}
        </FormRow>
      )}

      <FormSection collapsible title="高级选项">
        <FormField label="带宽限制" name="bwlimit" hint="留空使用数据中心或存储的默认限制。">
          <NumberInput value={bwlimit} onChange={setBwlimit} min={0} unit="KiB/s" placeholder="默认" />
        </FormField>
      </FormSection>
    </FormDialog>
  )
}

function ModeCard({ value, selected, title, description }: { value: string; selected: boolean; title: string; description: string }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        'flex min-h-16 items-start gap-3 rounded-2xl px-4 py-3 text-left ring-1 ring-border/70 transition-[background-color,box-shadow] outline-none ring-inset',
        'bg-foreground/[0.04] hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring paper:bg-secondary/50',
        selected && 'bg-brand/10 ring-2 ring-brand hover:bg-brand/12 paper:bg-brand/10',
      )}
    >
      <span
        aria-hidden
        className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-brand' : 'border-control')}
      >
        <RadioGroupPrimitive.Indicator className="block size-2.5 rounded-full bg-brand" />
      </span>
      <span className="grid gap-0.5">
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </RadioGroupPrimitive.Item>
  )
}
