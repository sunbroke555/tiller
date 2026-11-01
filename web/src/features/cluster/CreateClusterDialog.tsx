// Create a cluster on this (standalone) node: name + corosync links
// (PVE.ClusterCreateWindow), node id and votes under 高级.

import { useEffect, useMemo, useState } from 'react'

import { createCluster, useLinkCandidates } from '@/api/cluster'
import { FieldInput, FormDialog, FormField, FormRow, FormSection } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'

import { LinkEditor } from './LinkEditor'
import {
  CLUSTER_NAME_MAX,
  addressCandidates,
  createParams,
  linkErrors,
  validateClusterName,
  validateNodeId,
  validateVotes,
  type LinkRow,
} from './logic'
import { Notice } from './ui'

export function CreateClusterDialog({ open, onOpenChange, node }: { open: boolean; onOpenChange: (o: boolean) => void; node: string }) {
  const networks = useLinkCandidates(open ? node : null)
  const candidates = useMemo(() => addressCandidates(networks.data ?? []), [networks.data])
  const [name, setName] = useState('')
  const [links, setLinks] = useState<LinkRow[]>([])
  const [nodeid, setNodeid] = useState('')
  const [votes, setVotes] = useState('')
  const [tried, setTried] = useState(false)

  useEffect(() => {
    if (!open) return
    setName('')
    setNodeid('')
    setVotes('')
    setTried(false)
    setLinks([])
  }, [open])

  // Pre-fill link 0 with the first address once the interfaces are known (like the official editor).
  useEffect(() => {
    if (open && networks.isFetched && links.length === 0) setLinks([{ number: 0, address: candidates[0]?.address ?? '', priority: '' }])
  }, [open, networks.isFetched, candidates, links.length])

  const nameError = validateClusterName(name)
  const errors = linkErrors(links, { priority: true })
  const nodeidError = validateNodeId(nodeid)
  const votesError = validateVotes(votes)
  const invalid = !!nameError || Object.keys(errors).length > 0 || links.length === 0 || !!nodeidError || !!votesError

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建集群"
      description={`在 ${node} 上创建新集群，本节点成为第一个成员。`}
      size="lg"
      submitLabel="创建集群"
      onSubmit={async () => {
        setTried(true)
        if (invalid) throw new Error('请先修正标出的字段')
        const clustername = name.trim()
        await runTask(createCluster(createParams({ clustername, links, nodeid, votes })), {
          title: `创建集群 ${clustername}`,
        })
      }}
    >
      <Notice tone="warning">
        创建后无法在界面中撤销。集群至少需要 3 个节点（或 2 个节点加 QDevice）才能在单个节点故障时保持法定人数。
      </Notice>
      <FormField label="集群名称" name="clustername" required error={tried ? nameError : undefined} hint={`最多 ${CLUSTER_NAME_MAX} 个字符，创建后不能修改。`}>
        <FieldInput value={name} onChange={(e) => setName(e.target.value)} maxLength={CLUSTER_NAME_MAX} placeholder="例如 pve-cluster" autoCapitalize="off" spellCheck={false} />
      </FormField>
      <FormField label="集群网络" name="link0" hint="Corosync 对延迟很敏感，建议用独立的低延迟网络；多条链路在故障时自动切换。">
        <LinkEditor rows={links} onChange={setLinks} candidates={candidates} editable errors={errors} showErrors={tried} />
      </FormField>
      <FormSection title="高级" collapsible>
        <FormRow>
          <FormField label="节点 ID" name="nodeid" error={nodeidError} hint="留空自动分配（从 1 开始）">
            <FieldInput value={nodeid} onChange={(e) => setNodeid(e.target.value)} inputMode="numeric" placeholder="自动" />
          </FormField>
          <FormField label="票数" name="votes" error={votesError} hint="本节点的法定票数，留空为 1">
            <FieldInput value={votes} onChange={(e) => setVotes(e.target.value)} inputMode="numeric" placeholder="1" />
          </FormField>
        </FormRow>
      </FormSection>
    </FormDialog>
  )
}
