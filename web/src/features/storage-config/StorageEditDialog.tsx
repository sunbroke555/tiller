// Add / edit one storage.cfg entry. One dialog for every type: the fields of
// the type (model.ts decides which are sent), content and node restriction,
// advanced options, backup retention and — for PBS — client encryption.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'

import {
  createStorage,
  fetchStorageDef,
  listCephFs,
  listCephMons,
  listCephPools,
  listIscsiLuns,
  scanCifs,
  scanIscsi,
  scanLvm,
  scanLvmThin,
  scanNfs,
  scanPbs,
  scanZfs,
  storageConfigKeys,
  updateStorage,
  useStorageDefs,
  type StorageDef,
  type StorageType,
  type StorageWriteResult,
} from '@/api/storage-config'
import { usePveFeature } from '@/api/pve-features'
import { useClusterResources } from '@/api/queries'
import { isNode } from '@/api/types'
import {
  FieldInput,
  FieldTextarea,
  FormDialog,
  FormField,
  FormRow,
  FormSection,
  NodeSelect,
  NumberInput,
  SelectField,
  SwitchField,
} from '@/components/form'
import { ConfigChangedContext } from '@/components/form/FormDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { PRUNE_KEYS, PRUNE_LABEL, pruneBackupsString } from '@/features/storage-browser/volumes'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'
import { formatBytes } from '@/lib/format'

import { ContentChips, FixedList, InputWithAction, NodeChips, Notice, ScanButton } from './fields'
import {
  createParams,
  fixedFields,
  hasWriteCacheOption,
  initialForm,
  ISCSI_PROVIDERS,
  NFS_VERSIONS,
  nodesLocked,
  parseHostPort,
  preallocationActive,
  PREALLOCATION_OPTIONS,
  retentionSummary,
  SMB_VERSIONS,
  snapshotChainEditable,
  STORAGE_TYPE_INFO,
  updateParams,
  validateForm,
  type CryptMode,
  type StorageForm,
} from './model'

export interface StorageEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: StorageType
  /** Set to edit this storage; unset to add a new one of `type`. */
  storageId?: string
  /** Called after a successful save with PVE's answer (PBS: generated key). */
  onSaved?: (storage: string, result: StorageWriteResult | null) => void
}

type SetForm = (patch: Partial<StorageForm>) => void

export function StorageEditDialog({ open, onOpenChange, type, storageId, onSaved }: StorageEditDialogProps) {
  const create = !storageId
  const info = STORAGE_TYPE_INFO[type]
  const defQuery = useQuery({
    queryKey: storageConfigKeys.one(storageId ?? ''),
    queryFn: ({ signal }) => fetchStorageDef(storageId!, signal),
    enabled: open && !create,
    staleTime: 0,
  })
  const snap = useOpenSnapshot(open, defQuery.data)
  // The list polls; a newer storage.cfg digest means a save will be refused.
  const list = useStorageDefs({ enabled: open && !create })
  const liveDigest = list.data?.find((d) => d.storage === storageId)?.digest
  const changed = !create && !!snap?.digest && !!liveDigest && liveDigest !== snap.digest

  const [form, setFormState] = useState<StorageForm | null>(null)
  const [seeded, setSeeded] = useState<unknown>(null)
  const [tried, setTried] = useState(false)
  const source: unknown = create ? type : snap
  if (open && source && seeded !== source) {
    setSeeded(source)
    setFormState(initialForm(type, create ? undefined : snap))
    setTried(false)
  } else if (!open && seeded !== null) {
    setSeeded(null)
  }
  const set: SetForm = (patch) => setFormState((f) => (f ? { ...f, ...patch } : f))

  const errors = useMemo(() => (form ? validateForm(form, create) : {}), [form, create])
  const err = (k: string) => (tried ? errors[k] : undefined)

  async function submit() {
    if (!form) return
    setTried(true)
    if (Object.keys(validateForm(form, create)).length) throw new Error('请先修正标出的问题')
    if (create) {
      const id = form.storage.trim()
      const result = await createStorage(createParams(form))
      await runTask(Promise.resolve(null), { title: `添加存储 ${id}`, syncSuccessMessage: `已添加存储 ${id}` })
      onSaved?.(id, result)
      return
    }
    if (!snap || !storageId) return
    const params = updateParams(form, snap)
    if (!params) return
    const result = await updateStorage(storageId, params)
    await runTask(Promise.resolve(null), { title: `保存存储 ${storageId}`, syncSuccessMessage: `已保存存储 ${storageId}` })
    onSaved?.(storageId, result)
  }

  const loading = !create && !form
  const title = create ? `添加${info.label}存储` : `编辑存储 ${storageId}`

  return (
    <ConfigChangedContext value={changed}>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        size="lg"
        title={title}
        description={create ? info.description : info.label}
        submitLabel={create ? '添加' : '保存'}
        submitDisabled={loading}
        onSubmit={submit}
      >
        {defQuery.isError && !form ? (
          <Notice tone="error">无法读取存储配置。</Notice>
        ) : loading || !form ? (
          <div className="grid gap-4">
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-10 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
        ) : (
          <EditorBody form={form} set={set} create={create} def={snap} err={err} />
        )}
      </FormDialog>
    </ConfigChangedContext>
  )
}

// ------------------------------------------------------------------ body

interface BodyProps {
  form: StorageForm
  set: SetForm
  create: boolean
  def: StorageDef | undefined
  err: (key: string) => string | undefined
}

function EditorBody({ form, set, create, def, err }: BodyProps) {
  const info = STORAGE_TYPE_INFO[form.type]
  const scan = useScanNode(form, set)
  return (
    <>
      {info.preview && <Notice tone="warning">{info.preview}</Notice>}

      {create ? (
        <FormField label="ID" name="storage" required error={err('storage')} hint="创建后不能修改，例如 nas-backup">
          <FieldInput
            value={form.storage}
            onChange={(e) => set({ storage: e.target.value })}
            placeholder="存储 ID"
            autoCapitalize="off"
            spellCheck={false}
            autoFocus
          />
        </FormField>
      ) : (
        def && <FixedList rows={[{ label: 'ID', value: def.storage }, ...fixedFields(def)]} />
      )}

      {scan.picker}
      <TypeFields form={form} set={set} create={create} def={def} err={err} scanNode={scan.node} />

      <FormSection>
        {info.contents && (
          <FormField label="内容" name="content" required error={err('content')}>
            <ContentChips options={info.contents} value={form.content} onChange={(content) => set({ content })} />
          </FormField>
        )}
        <FormField
          label="节点"
          name="nodes"
          hint={nodesLocked(form.storage) ? 'local 存储在每个节点上都有，不能限制节点。' : '不选表示所有节点都能使用这个存储。'}
        >
          <NodeChips value={form.nodes} onChange={(nodes) => set({ nodes })} disabled={nodesLocked(form.storage)} />
        </FormField>
        <div className="grid gap-1">
          <SwitchField label="启用" description="禁用后节点不会激活这个存储" checked={form.enable} onCheckedChange={(enable) => set({ enable })} />
          {info.shared && (
            <SwitchField
              label="共享"
              description={
                form.type === 'lvm'
                  ? 'LVM 位于共享 LUN 上时开启'
                  : '底层文件系统已在节点间共享时开启（只是标记，不会自动共享内容）'
              }
              checked={form.shared}
              onCheckedChange={(shared) => set({ shared })}
            />
          )}
        </div>
      </FormSection>

      <AdvancedSection form={form} set={set} create={create} />
      {form.type === 'pbs' && <EncryptionSection form={form} set={set} create={create} def={def} err={err} />}
      {info.backups && <RetentionSection form={form} set={set} err={err} />}
    </>
  )
}

// -------------------------------------------------------------- scan node

/** Types whose scans run on one node (multi-node clusters pick it). */
const SCAN_TYPES = new Set<StorageType>(['nfs', 'cifs', 'iscsi', 'iscsidirect', 'lvm', 'lvmthin', 'zfspool', 'pbs', 'cephfs', 'rbd'])
/** Local resources: picking the scan node restricts the storage to it (official). */
const NODE_BOUND = new Set<StorageType>(['lvm', 'lvmthin', 'zfspool', 'iscsi'])

function useScanNode(form: StorageForm, set: SetForm) {
  const { data: nodes } = useClusterResources({
    select: (all) =>
      all
        .filter(isNode)
        .filter((n) => n.status === 'online')
        .map((n) => n.node)
        .sort(),
  })
  const [picked, setPicked] = useState<string | undefined>()
  const node = picked ?? nodes?.[0]
  const show = SCAN_TYPES.has(form.type) && (nodes?.length ?? 0) > 1
  const picker = show ? (
    <FormField label="扫描用节点" hint="扫描和下拉列表从这个节点读取。">
      <NodeSelect
        value={node}
        onValueChange={(n) => {
          setPicked(n)
          if (n && NODE_BOUND.has(form.type)) set({ nodes: [n] })
        }}
      />
    </FormField>
  ) : null
  return { node, picker }
}

// ----------------------------------------------------------- type fields

interface TypeFieldsProps extends BodyProps {
  scanNode: string | undefined
}

function TextRow({
  label,
  name,
  value,
  onChange,
  err,
  required,
  hint,
  placeholder,
  password,
  mono,
  children,
}: {
  label: ReactNode
  name: string
  value: string
  onChange: (v: string) => void
  err: BodyProps['err']
  required?: boolean
  hint?: ReactNode
  placeholder?: string
  password?: boolean
  mono?: boolean
  /** A trailing button (scan) on the same row. */
  children?: ReactNode
}) {
  const input = (
    <FieldInput
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      type={password ? 'password' : 'text'}
      autoComplete={password ? 'new-password' : 'off'}
      autoCapitalize="off"
      spellCheck={false}
      className={mono ? 'font-mono text-[13px]' : undefined}
    />
  )
  return (
    <FormField label={label} name={name} required={required} hint={hint} error={err(name)}>
      {children ? (
        <InputWithAction>
          {input}
          {children}
        </InputWithAction>
      ) : (
        input
      )}
    </FormField>
  )
}

function TypeFields(props: TypeFieldsProps) {
  const { form, create } = props
  switch (form.type) {
    case 'dir':
    case 'btrfs':
      return create ? (
        <TextRow label={form.type === 'dir' ? '目录' : '路径'} name="path" required value={form.path} onChange={(path) => props.set({ path })} err={props.err} placeholder="/mnt/data" mono />
      ) : null
    case 'nfs':
      return <NfsFields {...props} />
    case 'cifs':
      return <CifsFields {...props} />
    case 'lvm':
      return <LvmFields {...props} />
    case 'lvmthin':
      return <LvmThinFields {...props} />
    case 'zfspool':
      return <ZfsPoolFields {...props} />
    case 'iscsi':
    case 'iscsidirect':
      return <IscsiFields {...props} />
    case 'zfs':
      return <ZfsIscsiFields {...props} />
    case 'cephfs':
    case 'rbd':
      return <CephFields {...props} />
    case 'pbs':
      return <PbsFields {...props} />
    case 'esxi':
      return <EsxiFields {...props} />
  }
}

function NfsFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  if (!create) return null
  return (
    <FormRow>
      <TextRow label="服务器" name="server" required value={form.server} onChange={(server) => set({ server, export: '' })} err={err} placeholder="IP 或主机名" />
      <TextRow label="导出路径" name="export" required value={form.export} onChange={(v) => set({ export: v })} err={err} placeholder="/export/pve" mono>
        <ScanButton
          resetKey={form.server}
          blocked={!form.server.trim() ? '先填写服务器' : !scanNode ? '没有在线节点' : null}
          scan={async (signal) => (await scanNfs(scanNode!, form.server.trim(), signal)).map((x) => ({ value: x.path, description: x.options }))}
          onPick={(v) => set({ export: v })}
          emptyText="服务器没有导出目录"
        />
      </TextRow>
    </FormRow>
  )
}

function CifsFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  if (!create) {
    return (
      <TextRow label="新密码" name="password" value={form.password} onChange={(password) => set({ password })} err={err} placeholder="不修改" password />
    )
  }
  return (
    <>
      <FormRow>
        <TextRow label="服务器" name="server" required value={form.server} onChange={(server) => set({ server })} err={err} placeholder="IP 或主机名" />
        <TextRow label="域" name="domain" value={form.domain} onChange={(domain) => set({ domain })} err={err} placeholder="可选" />
      </FormRow>
      <FormRow>
        <TextRow label="用户名" name="username" value={form.username} onChange={(username) => set({ username })} err={err} placeholder="访客" />
        <TextRow label="密码" name="password" value={form.password} onChange={(password) => set({ password })} err={err} placeholder="无" password />
      </FormRow>
      <FormRow>
        <TextRow label="共享" name="share" required value={form.share} onChange={(share) => set({ share })} err={err} placeholder="共享名称">
          <ScanButton
            resetKey={`${form.server}|${form.username}|${form.password}|${form.domain}`}
            blocked={!form.server.trim() ? '先填写服务器' : !scanNode ? '没有在线节点' : null}
            scan={async (signal) =>
              (
                await scanCifs(
                  scanNode!,
                  {
                    server: form.server.trim(),
                    ...(form.username ? { username: form.username } : {}),
                    ...(form.password ? { password: form.password } : {}),
                    ...(form.domain ? { domain: form.domain } : {}),
                  },
                  signal,
                )
              ).map((x) => ({ value: x.share, description: x.description }))
            }
            onPick={(share) => set({ share })}
            emptyText="没有可用的共享"
          />
        </TextRow>
        <TextRow label="子目录" name="subdir" value={form.subdir} onChange={(subdir) => set({ subdir })} err={err} placeholder="/some/path（可选）" mono />
      </FormRow>
    </>
  )
}

function IscsiFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  return (
    <>
      {create && (
        <FormRow>
          <TextRow label="Portal" name="portal" required value={form.portal} onChange={(portal) => set({ portal, target: '' })} err={err} placeholder="IP[:端口]" />
          <TextRow label="Target" name="target" required value={form.target} onChange={(target) => set({ target })} err={err} placeholder="iqn.…" mono>
            <ScanButton
              resetKey={form.portal}
              blocked={!form.portal.trim() ? '先填写 Portal' : !scanNode ? '没有在线节点' : null}
              scan={async (signal) => (await scanIscsi(scanNode!, form.portal.trim(), signal)).map((x) => ({ value: x.target, description: x.portal }))}
              onPick={(target) => set({ target })}
              emptyText="没有找到 iSCSI target"
            />
          </TextRow>
        </FormRow>
      )}
      {form.type === 'iscsi' && (
        <SwitchField
          label="直接使用 LUN"
          description="关闭后只作为其他存储（如 LVM）的底层，不直接存放虚拟机磁盘"
          checked={form.luns}
          onCheckedChange={(luns) => set({ luns })}
        />
      )}
    </>
  )
}

function useLocalScan<T>(key: string, node: string | undefined, fn: (node: string, signal: AbortSignal) => Promise<T[]>, enabled = true, extra?: string) {
  return useQuery({
    queryKey: storageConfigKeys.scan(node ?? '', key, extra ? { extra } : undefined),
    queryFn: ({ signal }) => fn(node!, signal),
    enabled: !!node && enabled,
    staleTime: 30_000,
    retry: false,
  })
}

function scanPlaceholder(q: { isPending: boolean; isError: boolean; fetchStatus: string }, count: number, none: string, idle = '请选择') {
  if (q.isError) return '扫描失败'
  if (q.isPending && q.fetchStatus !== 'idle') return '正在扫描…'
  return count === 0 && !q.isPending ? none : idle
}

function LvmFields({ form, set, create, def, err, scanNode }: TypeFieldsProps) {
  const discardSupport = usePveFeature('storageOnVolumeRemove')
  // Older PVE rejects the key; a storage that already has it proves support.
  const showDiscard = discardSupport === 'supported' || (!create && def?.['on-volume-remove'] !== undefined)
  const vgs = useLocalScan('lvm', scanNode, scanLvm, create && !form.baseStorage)
  const defs = useStorageDefs({ enabled: create })
  const iscsi = (defs.data ?? []).filter((d) => d.type === 'iscsi')
  const luns = useLocalScan('luns', scanNode, (n, s) => listIscsiLuns(n, form.baseStorage, s), create && !!form.baseStorage, form.baseStorage)
  return (
    <>
      {create && (
        <>
          <FormField label="底层存储" hint="在 iSCSI LUN 上新建卷组，或使用节点上已有的卷组。">
            <SelectField
              value={form.baseStorage}
              onValueChange={(v) => set({ baseStorage: v ?? '', base: '', vgname: '' })}
              emptyOption="现有卷组"
              options={iscsi.map((d) => ({ value: d.storage, label: `${d.storage} (iSCSI)`, description: d.target }))}
            />
          </FormField>
          {form.baseStorage ? (
            <FormRow>
              <FormField label="底层卷" name="base" required error={err('base')}>
                <SelectField
                  value={form.base}
                  onValueChange={(v) => set({ base: v ?? '' })}
                  loading={luns.isPending && luns.fetchStatus !== 'idle'}
                  placeholder={scanPlaceholder(luns, luns.data?.length ?? 0, '没有可用的 LUN')}
                  options={(luns.data ?? []).map((l) => ({ value: l.volid, label: l.volid.replace(/^[^:]+:/, ''), description: l.size ? formatBytes(l.size) : undefined }))}
                />
              </FormField>
              <TextRow label="卷组名称" name="vgname" required value={form.vgname} onChange={(vgname) => set({ vgname })} err={err} placeholder="新卷组的名称" />
            </FormRow>
          ) : (
            <FormField label="卷组" name="vgname" required error={err('vgname')}>
              <SelectField
                value={form.vgname}
                onValueChange={(v) => set({ vgname: v ?? '' })}
                loading={vgs.isPending && vgs.fetchStatus !== 'idle'}
                placeholder={scanPlaceholder(vgs, vgs.data?.length ?? 0, '节点上没有卷组')}
                options={(vgs.data ?? []).map((g) => ({ value: g.vg, label: g.vg, description: g.size ? `${formatBytes(g.free ?? 0)} 可用 / ${formatBytes(g.size)}` : undefined }))}
              />
            </FormField>
          )}
        </>
      )}
      <SwitchField label="删除时擦除卷" description="删除逻辑卷前先写零（saferemove），较慢" checked={form.saferemove} onCheckedChange={(saferemove) => set({ saferemove })} />
      {showDiscard && (
        <SwitchField
          label="删除卷时执行 discard（TRIM）"
          description="删除的逻辑卷会在后台 discard，把空间还给精简置备的 LUN 或 SSD。"
          checked={form.discardOnRemove}
          onCheckedChange={(discardOnRemove) => set({ discardOnRemove })}
        />
      )}
    </>
  )
}

function LvmThinFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  const vgs = useLocalScan('lvm', scanNode, scanLvm, create)
  const pools = useLocalScan('lvmthin', scanNode, (n, s) => scanLvmThin(n, form.vgname, s), create && !!form.vgname, form.vgname)
  if (!create) return null
  return (
    <FormRow>
      <FormField label="卷组" name="vgname" required error={err('vgname')}>
        <SelectField
          value={form.vgname}
          onValueChange={(v) => set({ vgname: v ?? '', thinpool: '' })}
          loading={vgs.isPending && vgs.fetchStatus !== 'idle'}
          placeholder={scanPlaceholder(vgs, vgs.data?.length ?? 0, '节点上没有卷组')}
          options={(vgs.data ?? []).map((g) => ({ value: g.vg, label: g.vg, description: g.size ? `${formatBytes(g.free ?? 0)} 可用` : undefined }))}
        />
      </FormField>
      <FormField label="精简池" name="thinpool" required error={err('thinpool')}>
        <SelectField
          value={form.thinpool}
          onValueChange={(v) => set({ thinpool: v ?? '' })}
          disabled={!form.vgname}
          loading={!!form.vgname && pools.isPending && pools.fetchStatus !== 'idle'}
          placeholder={!form.vgname ? '先选择卷组' : scanPlaceholder(pools, pools.data?.length ?? 0, '卷组里没有精简池')}
          options={(pools.data ?? []).map((p) => ({ value: p.lv, label: p.lv, description: p.lv_size ? formatBytes(p.lv_size) : undefined }))}
        />
      </FormField>
    </FormRow>
  )
}

function ZfsPoolFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  const pools = useLocalScan('zfs', scanNode, scanZfs, create)
  return (
    <>
      {create && (
        <FormField label="ZFS 池" name="pool" required error={err('pool')}>
          <SelectField
            value={form.pool}
            onValueChange={(v) => set({ pool: v ?? '' })}
            loading={pools.isPending && pools.fetchStatus !== 'idle'}
            placeholder={scanPlaceholder(pools, pools.data?.length ?? 0, '节点上没有 ZFS 池')}
            options={(pools.data ?? []).map((p) => ({ value: p.pool, label: p.pool, description: p.size ? `${formatBytes(p.free ?? 0)} 可用` : undefined }))}
          />
        </FormField>
      )}
      <FormRow>
        <TextRow label="块大小" name="blocksize" value={form.blocksize} onChange={(blocksize) => set({ blocksize })} err={err} placeholder="16k" mono />
        <div className="grid content-end">
          <SwitchField label="精简置备" checked={form.sparse} onCheckedChange={(sparse) => set({ sparse })} />
        </div>
      </FormRow>
    </>
  )
}

function ZfsIscsiFields({ form, set, create, err }: TypeFieldsProps) {
  const comstar = form.iscsiprovider === 'comstar'
  const lio = form.iscsiprovider === 'LIO'
  return (
    <>
      {create && (
        <>
          <FormRow>
            <TextRow label="Portal" name="portal" required value={form.portal} onChange={(portal) => set({ portal })} err={err} placeholder="IP[:端口]" />
            <TextRow label="池" name="pool" required value={form.pool} onChange={(pool) => set({ pool })} err={err} placeholder="tank" mono />
          </FormRow>
          <FormRow>
            <TextRow label="Target" name="target" required value={form.target} onChange={(target) => set({ target })} err={err} placeholder="iqn.…" mono />
            <TextRow label="块大小" name="blocksize" required value={form.blocksize} onChange={(blocksize) => set({ blocksize })} err={err} placeholder="4k" mono />
          </FormRow>
          <FormField label="iSCSI 提供方" name="iscsiprovider">
            <SelectField value={form.iscsiprovider} onValueChange={(v) => set({ iscsiprovider: v ?? 'comstar' })} options={ISCSI_PROVIDERS} />
          </FormField>
          {comstar && (
            <FormRow>
              <TextRow label="Target 组" name="comstar_tg" value={form.comstar_tg} onChange={(comstar_tg) => set({ comstar_tg })} err={err} placeholder="可选" />
              <TextRow label="主机组" name="comstar_hg" value={form.comstar_hg} onChange={(comstar_hg) => set({ comstar_hg })} err={err} placeholder="可选" />
            </FormRow>
          )}
          {lio && <TextRow label="Target portal 组" name="lio_tpg" required value={form.lio_tpg} onChange={(lio_tpg) => set({ lio_tpg })} err={err} placeholder="tpg1" />}
        </>
      )}
      <div className="grid gap-1">
        <SwitchField label="精简置备" checked={form.sparse} onCheckedChange={(sparse) => set({ sparse })} />
        {hasWriteCacheOption(form.iscsiprovider) && (
          <SwitchField label="写缓存" description="关闭后 target 上不缓存写入" checked={form.writecache} onCheckedChange={(writecache) => set({ writecache })} />
        )}
      </div>
    </>
  )
}

function CephFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  const rbd = form.type === 'rbd'
  // Hyper-converged Ceph is possible when this cluster runs monitors.
  const mons = useQuery({
    queryKey: storageConfigKeys.scan(scanNode ?? '', 'ceph-mon'),
    queryFn: ({ signal }) => listCephMons(scanNode!, signal),
    enabled: create && !!scanNode,
    staleTime: 60_000,
    retry: false,
  })
  const managedPossible = (mons.data?.length ?? 0) > 0
  useEffect(() => {
    if (create && managedPossible) set({ pveceph: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when monitors are found
  }, [create, managedPossible])
  const pools = useQuery({
    queryKey: storageConfigKeys.scan(scanNode ?? '', 'ceph-pool'),
    queryFn: ({ signal }) => listCephPools(scanNode!, signal),
    enabled: create && rbd && form.pveceph && !!scanNode,
    retry: false,
  })
  const fss = useQuery({
    queryKey: storageConfigKeys.scan(scanNode ?? '', 'ceph-fs'),
    queryFn: ({ signal }) => listCephFs(scanNode!, signal),
    enabled: create && !rbd && form.pveceph && !!scanNode,
    retry: false,
  })
  const external = !form.pveceph

  return (
    <>
      {create && (
        <SwitchField
          label={rbd ? '使用本集群（PVE 管理）的 Ceph 池' : '使用本集群（PVE 管理）的 CephFS'}
          description={managedPossible ? `监视器：${mons.data!.map((m) => m.name).join(', ')}` : '本集群没有运行 Ceph 监视器，只能连接外部集群'}
          checked={form.pveceph}
          disabled={!managedPossible}
          onCheckedChange={(pveceph) => set({ pveceph })}
        />
      )}
      {create && rbd && (
        <FormField label="池" name="pool" required error={err('pool')}>
          {form.pveceph ? (
            <SelectField
              value={form.pool}
              onValueChange={(v) => set({ pool: v ?? '' })}
              loading={pools.isPending && pools.fetchStatus !== 'idle'}
              placeholder={scanPlaceholder(pools, pools.data?.length ?? 0, '没有 Ceph 池')}
              options={(pools.data ?? []).map((p) => ({ value: p.pool_name, label: p.pool_name }))}
            />
          ) : (
            <FieldInput value={form.pool} onChange={(e) => set({ pool: e.target.value })} placeholder="rbd" autoCapitalize="off" spellCheck={false} />
          )}
        </FormField>
      )}
      {create && !rbd && (
        <FormField label="文件系统" name="fs-name" required={form.pveceph} error={err('fs-name')} hint={form.pveceph ? undefined : '留空使用集群的默认文件系统'}>
          {form.pveceph ? (
            <SelectField
              value={form.fsName}
              onValueChange={(v) => set({ fsName: v ?? '' })}
              loading={fss.isPending && fss.fetchStatus !== 'idle'}
              placeholder={scanPlaceholder(fss, fss.data?.length ?? 0, '没有 CephFS')}
              options={(fss.data ?? []).map((f) => ({ value: f.name, label: f.name }))}
            />
          ) : (
            <FieldInput value={form.fsName} onChange={(e) => set({ fsName: e.target.value })} placeholder="cephfs" autoCapitalize="off" spellCheck={false} />
          )}
        </FormField>
      )}
      {external && (
        <TextRow
          label="监视器"
          name="monhost"
          required
          value={form.monhost}
          onChange={(monhost) => set({ monhost })}
          err={err}
          placeholder="10.0.0.1 10.0.0.2 10.0.0.3"
          hint="外部 Ceph 集群的监视器地址，多个用空格或逗号分隔"
          mono
        />
      )}
      {create && external && (
        <>
          <TextRow label="用户名" name="username" value={form.username} onChange={(username) => set({ username })} err={err} placeholder="admin" />
          <FormField label={rbd ? 'Keyring' : '密钥'} name="keyring" required error={err('keyring')} hint={rbd ? '客户端 keyring 文件的内容' : 'Ceph 用户的 secret'}>
            <FieldTextarea
              value={form.keyring}
              onChange={(e) => set({ keyring: e.target.value })}
              className="min-h-20 font-mono text-[13px]"
              spellCheck={false}
              autoCapitalize="off"
            />
          </FormField>
        </>
      )}
      {rbd && <SwitchField label="KRBD" description="总是通过内核 rbd 模块访问" checked={form.krbd} onCheckedChange={(krbd) => set({ krbd })} />}
    </>
  )
}

function PbsFields({ form, set, create, err, scanNode }: TypeFieldsProps) {
  if (!create) {
    return (
      <>
        <TextRow label="新密码" name="password" value={form.password} onChange={(password) => set({ password })} err={err} placeholder="不修改" password />
        <FingerprintField form={form} set={set} err={err} />
      </>
    )
  }
  const hp = parseHostPort(form.server)
  return (
    <>
      <TextRow label="服务器" name="server" required value={form.server} onChange={(server) => set({ server })} err={err} placeholder="pbs.lan 或 10.0.0.5:8007" />
      <FormRow>
        <TextRow label="用户名" name="username" required value={form.username} onChange={(username) => set({ username })} err={err} placeholder="admin@pbs" />
        <TextRow label="密码" name="password" required value={form.password} onChange={(password) => set({ password })} err={err} placeholder="密码或 API 令牌密钥" password />
      </FormRow>
      <FingerprintField form={form} set={set} err={err} />
      <FormRow>
        <TextRow label="数据存储" name="datastore" required value={form.datastore} onChange={(datastore) => set({ datastore })} err={err} placeholder="store1">
          <ScanButton
            resetKey={`${form.server}|${form.username}|${form.password}|${form.fingerprint}`}
            blocked={
              !hp ? '先填写服务器' : !form.username.trim() || !form.password ? '先填写用户名和密码' : !scanNode ? '没有在线节点' : null
            }
            scan={async (signal) =>
              (
                await scanPbs(
                  scanNode!,
                  {
                    server: hp!.server,
                    username: form.username.trim(),
                    password: form.password,
                    ...(hp?.port ? { port: hp.port } : {}),
                    ...(form.fingerprint.trim() ? { fingerprint: form.fingerprint.trim() } : {}),
                  },
                  signal,
                )
              ).map((d) => ({ value: d.store, description: d.comment }))
            }
            onPick={(datastore) => set({ datastore })}
            emptyText="没有可访问的数据存储"
          />
        </TextRow>
        <TextRow label="命名空间" name="namespace" value={form.namespace} onChange={(namespace) => set({ namespace })} err={err} placeholder="根" />
      </FormRow>
    </>
  )
}

function FingerprintField({ form, set, err }: Pick<BodyProps, 'form' | 'set' | 'err'>) {
  return (
    <TextRow
      label="指纹"
      name="fingerprint"
      value={form.fingerprint}
      onChange={(fingerprint) => set({ fingerprint })}
      err={err}
      placeholder="服务器证书不受信任时填写"
      hint="PBS 控制台“仪表盘 → 显示指纹”里的 SHA-256 指纹"
      mono
    />
  )
}

function EsxiFields({ form, set, create, err }: TypeFieldsProps) {
  return (
    <>
      {create && <TextRow label="服务器" name="server" required value={form.server} onChange={(server) => set({ server })} err={err} placeholder="IP 或主机名[:端口]" />}
      <FormRow>
        <TextRow label="用户名" name="username" required value={form.username} onChange={(username) => set({ username })} err={err} placeholder="root" />
        <TextRow
          label={create ? '密码' : '新密码'}
          name="password"
          required={create}
          value={form.password}
          onChange={(password) => set({ password })}
          err={err}
          placeholder={create ? '' : '不修改'}
          password
        />
      </FormRow>
      <SwitchField
        label="跳过证书验证"
        description="只在完全可信的网络里开启"
        checked={form.skipCertVerification}
        onCheckedChange={(skipCertVerification) => set({ skipCertVerification })}
      />
    </>
  )
}

// --------------------------------------------------------------- advanced

function AdvancedSection({ form, set, create }: { form: StorageForm; set: SetForm; create: boolean }) {
  const info = STORAGE_TYPE_INFO[form.type]
  const items: ReactNode[] = []
  if (info.preallocation) {
    items.push(
      <FormField key="prealloc" label="预分配" name="preallocation" hint={preallocationActive(form) ? 'raw 和 qcow2 镜像的预分配方式' : '内容包含“虚拟机磁盘”时才可设置'}>
        <SelectField
          value={form.preallocation}
          onValueChange={(v) => set({ preallocation: v ?? '' })}
          emptyOption="默认 (metadata)"
          options={PREALLOCATION_OPTIONS}
          disabled={!preallocationActive(form)}
        />
      </FormField>,
    )
  }
  if (form.type === 'nfs') {
    items.push(
      <FormField key="nfsver" label="NFS 版本" name="options">
        <SelectField
          value={form.nfsversion}
          onValueChange={(v) => set({ nfsversion: v ?? '' })}
          emptyOption="默认"
          options={NFS_VERSIONS.map((v) => ({ value: v, label: v }))}
        />
      </FormField>,
    )
  }
  if (form.type === 'cifs') {
    items.push(
      <FormField key="smbver" label="SMB 版本" name="smbversion">
        <SelectField
          value={form.smbversion}
          onValueChange={(v) => set({ smbversion: v ?? '' })}
          emptyOption="默认（自动协商）"
          options={SMB_VERSIONS.map((v) => ({ value: v, label: v }))}
        />
      </FormField>,
    )
  }
  if (form.type === 'rbd' && create) {
    items.push(
      <FormField key="ns" label="命名空间" name="namespace" hint={form.namespace ? 'RBD 命名空间需要事先手动创建' : undefined}>
        <FieldInput value={form.namespace} onChange={(e) => set({ namespace: e.target.value })} placeholder="可选" autoCapitalize="off" spellCheck={false} />
      </FormField>,
    )
  }
  if (info.snapshotChain) {
    const editable = snapshotChainEditable(form.type, create)
    items.push(
      <div key="chain" className="grid gap-2">
        <SwitchField
          label="允许快照为卷链"
          description={
            editable
              ? '用 qcow2 卷链实现快照（技术预览）'
              : '只能在创建时设置'
          }
          checked={form.snapshotChain}
          disabled={!editable}
          onCheckedChange={(snapshotChain) => set({ snapshotChain })}
        />
        {form.type === 'lvm' && !create && form.snapshotChain && <Notice tone="warning">存储上已有 qcow2 镜像时请保持开启。</Notice>}
      </div>,
    )
  }
  if (!items.length) return null
  return (
    <FormSection collapsible title="高级选项">
      {items}
    </FormSection>
  )
}

// ------------------------------------------------------------- encryption

const CRYPT_LABEL: Record<CryptMode, string> = {
  keep: '保留现有密钥',
  none: '不加密备份',
  autogen: '自动生成客户端加密密钥',
  upload: '使用已有的密钥',
}

function EncryptionSection({ form, set, create, def, err }: BodyProps) {
  const existing = def?.['encryption-key']
  const [allowEdit, setAllowEdit] = useState(!existing)
  const modes: CryptMode[] = existing ? ['keep', 'none', 'autogen', 'upload'] : ['none', 'autogen', 'upload']
  const label = (m: CryptMode) => (m === 'none' && existing ? '删除现有密钥（不再加密）' : CRYPT_LABEL[m])
  const replacing = !!existing && form.cryptMode !== 'keep'

  async function readFile(file: File | undefined) {
    if (!file) return
    set({ cryptKey: await file.text() })
  }

  return (
    <FormSection title="加密" description="客户端加密：备份在离开本机前加密，PBS 上只存密文。">
      {existing && (
        <p className="text-sm text-muted-foreground">
          当前：<span className="text-foreground">已启用</span>
          {/^[0-9a-f]{2}:/i.test(existing) && <span className="ml-1 font-mono text-xs">指纹 {existing.slice(0, 23)}</span>}
        </p>
      )}
      {existing && (
        <SwitchField
          label="修改现有密钥（危险）"
          checked={allowEdit}
          onCheckedChange={(v) => {
            setAllowEdit(v)
            if (!v) set({ cryptMode: 'keep', cryptKey: '' })
          }}
        />
      )}
      <RadioGroup
        value={form.cryptMode}
        onValueChange={(v) => set({ cryptMode: v as CryptMode })}
        disabled={!allowEdit}
        aria-label="加密方式"
        className="gap-1"
      >
        {modes.map((m) => (
          <Label key={m} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl text-sm font-normal has-[button:disabled]:cursor-not-allowed has-[button:disabled]:opacity-60">
            <RadioGroupItem value={m} />
            {label(m)}
          </Label>
        ))}
      </RadioGroup>
      {form.cryptMode === 'upload' && (
        <FormField label="密钥" name="encryption-key" required error={err('encryption-key')}>
          <FieldTextarea
            value={form.cryptKey}
            onChange={(e) => set({ cryptKey: e.target.value })}
            placeholder='粘贴密钥文件内容（{"kdf": …, "data": …}）'
            className="min-h-24 font-mono text-[13px]"
            spellCheck={false}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              void readFile(e.dataTransfer.files[0])
            }}
          />
          <div>
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <FileUp />
                选择密钥文件
                <input type="file" className="sr-only" onChange={(e) => void readFile(e.target.files?.[0])} />
              </label>
            </Button>
          </div>
        </FormField>
      )}
      {create && (form.cryptMode === 'autogen' || form.cryptMode === 'upload') && (
        <FormField label="主公钥" name="master-pubkey" hint="可选：PEM 格式的 RSA 公钥。每个备份会附带一份用它加密的密钥副本，丢失客户端密钥时可用主私钥恢复。">
          <FieldTextarea
            value={form.masterPubkey}
            onChange={(e) => set({ masterPubkey: e.target.value })}
            placeholder="-----BEGIN PUBLIC KEY-----"
            className="min-h-20 font-mono text-[13px]"
            spellCheck={false}
          />
        </FormField>
      )}
      {form.cryptMode === 'autogen' && <Notice>保存后会显示生成的密钥，请务必妥善保存。</Notice>}
      {replacing && <Notice tone="warning">删除或替换加密密钥后，用旧密钥加密的备份将无法恢复！</Notice>}
    </FormSection>
  )
}

// -------------------------------------------------------------- retention

function RetentionSection({ form, set, err }: Pick<BodyProps, 'form' | 'set' | 'err'>) {
  const summary = form.keepAll ? '全部保留' : (retentionSummary(pruneBackupsString(form.keep)) ?? '未设置')
  const anyKeep = PRUNE_KEYS.some((k) => (form.keep[k] ?? 0) > 0)
  return (
    <FormSection collapsible title="备份保留" description={summary}>
      <SwitchField label="保留全部备份" checked={form.keepAll} onCheckedChange={(keepAll) => set({ keepAll })} />
      <FormRow cols={3} className="grid-cols-3 gap-x-2.5 gap-y-3 sm:gap-x-4">
        {PRUNE_KEYS.map((k) => (
          <FormField key={k} label={<span className="text-xs font-normal text-muted-foreground">{PRUNE_LABEL[k]}</span>} className="gap-1.5">
            <NumberInput
              aria-label={`保留${PRUNE_LABEL[k]}`}
              value={form.keep[k]}
              onChange={(v) => set({ keep: { ...form.keep, [k]: v && v > 0 ? v : undefined } })}
              min={0}
              max={10000}
              placeholder="—"
              disabled={form.keepAll}
            />
          </FormField>
        ))}
      </FormRow>
      {!form.keepAll && !anyKeep && <p className="text-xs text-muted-foreground">不设置时，备份任务使用节点 vzdump.conf 的设置或全部保留。</p>}
      {form.type === 'pbs' && <Notice>建议直接在 Proxmox Backup Server 上配置保留策略。</Notice>}
      <FormField label="最多受保护备份" name="max-protected-backups" error={err('max-protected-backups')} hint="每个客户机最多可标记为受保护的备份数，-1 表示不限。">
        <NumberInput
          value={form.maxProtected}
          onChange={(maxProtected) => set({ maxProtected })}
          min={-1}
          placeholder="默认（有 Datastore.Allocate 权限时不限，否则 5）"
        />
      </FormField>
    </FormSection>
  )
}
