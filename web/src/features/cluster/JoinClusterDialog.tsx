// Join this node into an existing cluster (PVE.ClusterJoinNodeWindow).
// Assisted: paste the encoded join information — peer address, fingerprint
// and the cluster's links are filled in, only this node's link addresses and
// the peer's root password remain. Manual: enter everything yourself.

import { useEffect, useMemo, useState } from 'react'
import { CircleCheck } from 'lucide-react'

import { joinCluster, useLinkCandidates } from '@/api/cluster'
import { CheckboxField, FieldInput, FieldTextarea, FormDialog, FormField, FormRow, FormSection, SwitchField } from '@/components/form'
import { runTask, type TaskOutcome } from '@/components/tasks/tracker'

import { LinkEditor } from './LinkEditor'
import {
  addressCandidates,
  decodeJoinInfo,
  joinLinkRows,
  joinParams,
  linkErrors,
  validateFingerprint,
  validateNodeId,
  validateVotes,
  type JoinInfo,
  type LinkRow,
} from './logic'
import { Notice } from './ui'

export interface JoinClusterDialogProps {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** This node (the one joining). */
  node: string
  /** Guests on this node: PVE refuses to join while there are any. */
  guestCount: number
  /** The join task ended (ok / warning / error). */
  onFinished?: (outcome: TaskOutcome) => void
}

export function JoinClusterDialog({ open, onOpenChange, node, guestCount, onFinished }: JoinClusterDialogProps) {
  const networks = useLinkCandidates(open ? node : null)
  const candidates = useMemo(() => addressCandidates(networks.data ?? []), [networks.data])

  const [assisted, setAssisted] = useState(true)
  const [pasted, setPasted] = useState('')
  const [info, setInfo] = useState<JoinInfo | null>(null)
  const [hostname, setHostname] = useState('')
  const [fingerprint, setFingerprint] = useState('')
  const [password, setPassword] = useState('')
  const [links, setLinks] = useState<LinkRow[]>([])
  const [nodeid, setNodeid] = useState('')
  const [votes, setVotes] = useState('')
  const [force, setForce] = useState(false)
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open) return
    setAssisted(true)
    setPasted('')
    setInfo(null)
    setHostname('')
    setFingerprint('')
    setPassword('')
    setLinks([])
    setNodeid('')
    setVotes('')
    setForce(false)
    setTried(false)
  }, [open])

  const onPaste = (text: string) => {
    setPasted(text)
    const decoded = decodeJoinInfo(text)
    setInfo(decoded)
    setHostname(decoded?.ipAddress ?? '')
    setFingerprint(decoded?.fingerprint ?? '')
    setLinks(decoded ? joinLinkRows(decoded) : [])
  }

  const switchMode = (next: boolean) => {
    setAssisted(next)
    setTried(false)
    setInfo(null)
    setPasted('')
    setHostname('')
    setFingerprint('')
    // Manual: one editable link pre-filled with this node's first address.
    setLinks(next ? [] : [{ number: 0, address: candidates[0]?.address ?? '', priority: '' }])
  }

  const showFields = !assisted || !!info
  const pastedError = assisted ? (!pasted.trim() ? '请粘贴加入信息' : !info ? '这不是有效的加入信息（应为集群节点“加入信息”里的整段文本）' : null) : null
  const hostError = hostname.trim() ? null : '请输入集群中任一节点的地址'
  const fpError = validateFingerprint(fingerprint)
  const pwError = password ? null : '请输入对端节点的 root 密码'
  const errors = linkErrors(links)
  const nodeidError = validateNodeId(nodeid)
  const votesError = validateVotes(votes, 0)
  const invalid =
    !!pastedError || !!hostError || !!fpError || !!pwError || Object.keys(errors).length > 0 || links.length === 0 || !!nodeidError || !!votesError

  const clusterName = info?.totem.cluster_name
  const target = clusterName || hostname.trim()

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="加入集群"
      description={`把本节点 ${node} 加入一个已有的集群。`}
      size="lg"
      submitLabel={clusterName ? `加入 ${clusterName}` : '加入'}
      onSubmit={async () => {
        setTried(true)
        if (invalid) throw new Error('请先修正标出的字段')
        const handle = await runTask(joinCluster(joinParams({ hostname, fingerprint, password, links, nodeid, votes, force })), {
          title: `加入集群 ${target}`,
          invalidate: [],
        })
        void handle.done.then((o) => onFinished?.(o))
      }}
    >
      <SwitchField
        label="辅助加入"
        description="粘贴集群节点上“加入信息”里的文本，自动填入地址、指纹和链路。"
        checked={assisted}
        onCheckedChange={switchMode}
      />

      {guestCount > 0 && (
        <Notice tone="warning">
          本节点上还有 {guestCount} 台客户机。PVE 只允许没有客户机的节点加入集群，请先备份并删除（或迁到别处）。
        </Notice>
      )}

      {assisted && (
        <FormField label="加入信息" required error={tried ? pastedError : undefined}>
          <FieldTextarea
            value={pasted}
            onChange={(e) => onPaste(e.target.value)}
            placeholder="在这里粘贴加入信息"
            spellCheck={false}
            autoCapitalize="off"
            className="max-h-36 min-h-24 overflow-y-auto font-mono text-[12px] break-all"
            aria-label="加入信息"
          />
        </FormField>
      )}
      {assisted && info && (
        <p role="status" className="-mt-2 flex items-center gap-1.5 text-xs text-success-strong">
          <CircleCheck className="size-3.5" aria-hidden />
          集群 {clusterName || '（未命名）'} · {links.length} 条链路
        </p>
      )}

      {showFields && (
        <>
          <FormRow>
            <FormField label="对端地址" name="hostname" required error={tried && !assisted ? hostError : undefined}>
              <FieldInput
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                readOnly={assisted}
                placeholder="集群中任一节点的 IP 或主机名"
                autoCapitalize="off"
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            </FormField>
            <FormField label="对端 root 密码" name="password" required error={tried ? pwError : undefined}>
              <FieldInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            </FormField>
          </FormRow>
          <FormField
            label="对端证书指纹（SHA-256）"
            name="fingerprint"
            required
            error={tried || (!assisted && fingerprint) ? fpError : undefined}
            hint={assisted ? '来自加入信息。连接对端时会校验证书，不一致就拒绝加入。' : '在集群节点的“加入信息”或证书页面查看。'}
          >
            <FieldTextarea
              value={fingerprint}
              onChange={(e) => setFingerprint(e.target.value.replace(/\s+/g, ''))}
              readOnly={assisted}
              rows={2}
              spellCheck={false}
              autoCapitalize="characters"
              placeholder="AA:BB:CC:…（32 组）"
              className="min-h-0 resize-none font-mono text-[12px] break-all"
            />
          </FormField>
          <FormField label="集群网络" name="link0" hint={assisted ? '为集群的每条链路填写本节点在同一网络里的地址。' : undefined}>
            <LinkEditor rows={links} onChange={setLinks} candidates={candidates} editable={!assisted} priority={false} errors={errors} showErrors={tried} />
          </FormField>
          <FormSection title="高级" collapsible>
            <FormRow>
              <FormField label="节点 ID" name="nodeid" error={nodeidError} hint="留空自动分配">
                <FieldInput value={nodeid} onChange={(e) => setNodeid(e.target.value)} inputMode="numeric" placeholder="自动" />
              </FormField>
              <FormField label="票数" name="votes" error={votesError} hint="本节点的法定票数，留空为 1">
                <FieldInput value={votes} onChange={(e) => setVotes(e.target.value)} inputMode="numeric" placeholder="1" />
              </FormField>
            </FormRow>
            <CheckboxField label="节点已存在时不报错（force）" description="只在重新加入同名节点时使用。" checked={force} onCheckedChange={setForce} />
          </FormSection>
          <Notice tone="warning">
            加入后本节点的 /etc/pve 配置（存储、用户、防火墙等）会被集群的配置替换，证书也会更换。加入过程中当前会话会失效，完成后需要重新加载页面并登录。
          </Notice>
        </>
      )}
    </FormDialog>
  )
}
