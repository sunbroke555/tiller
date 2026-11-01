// Add one permission (PVE.dc.ACLAdd): path, user / group / API token, role,
// propagate. On a fixed path (guest, storage, pool pages) the path is given
// and propagate keeps the API default (on), like the official dialog.

import { useEffect, useMemo, useState } from 'react'

import { accessKeys, updateAcl, useGroups, useRoles, useUsers, type AclSubjectType } from '@/api/access-control'
import { useClusterResources } from '@/api/queries'
import { usePools } from '@/api/shell'
import { FieldInput, FormDialog, FormField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { SearchSelect, SuggestInput, type PickOption } from '@/features/firewall/pickers'
import { normalizeAclPath } from '@/lib/permissions'

import { ACL_PATH_GROUP_LABEL, ACL_SUBJECT_LABEL, aclAddParams, aclPathOptions, describeAclPath, parsePrivs, validateAclForm, type AclForm } from './logic'

export interface AclAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: AclSubjectType
  /** Fixed path (hidden path field and propagate switch). */
  path?: string | undefined
}

const TITLE: Record<AclSubjectType, string> = {
  user: '添加用户权限',
  group: '添加组权限',
  token: '添加 API 令牌权限',
}

export function AclAddDialog({ open, onOpenChange, type, path }: AclAddDialogProps) {
  const fixed = path !== undefined
  const [form, setForm] = useState<AclForm>({ path: path ?? '/', type, subject: '', role: '', propagate: true })
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!open) return
    setForm({ path: path ?? '/', type, subject: '', role: '', propagate: true })
    setTouched(false)
    // Reset when the dialog opens.
  }, [open])
  const set = <K extends keyof AclForm>(key: K, value: AclForm[K]) => setForm((f) => ({ ...f, [key]: value }))

  const users = useUsers(open && (type === 'user' || type === 'token'))
  const groups = useGroups(open && type === 'group')
  const roles = useRoles(open)
  const resources = useClusterResources({ enabled: open && !fixed })
  const pools = usePools()

  const pathOptions: PickOption[] = useMemo(
    () =>
      fixed
        ? []
        : aclPathOptions(resources.data ?? [], (pools.data ?? []).map((p) => p.poolid)).map((o) => ({
            value: o.value,
            label: o.value,
            description: o.label,
            group: ACL_PATH_GROUP_LABEL[o.group],
          })),
    [fixed, resources.data, pools.data],
  )

  const subjectOptions: PickOption[] = useMemo(() => {
    if (type === 'group') {
      return (groups.data ?? [])
        .map((g) => ({ value: g.groupid, label: g.groupid, description: g.comment }))
        .sort((a, b) => a.value.localeCompare(b.value))
    }
    if (type === 'token') {
      return (users.data ?? [])
        .flatMap((u) =>
          (u.tokens ?? []).map((t) => ({
            value: `${u.userid}!${t.tokenid}`,
            label: `${u.userid}!${t.tokenid}`,
            description: [t.privsep === 0 ? '与用户同权' : '权限分离', t.comment].filter(Boolean).join(' · '),
          })),
        )
        .sort((a, b) => a.value.localeCompare(b.value))
    }
    return (users.data ?? [])
      .map((u) => ({
        value: u.userid,
        label: u.userid,
        description: [u.enable === 0 ? '已停用' : '', [u.firstname, u.lastname].filter(Boolean).join(' '), u.comment].filter(Boolean).join(' · ') || undefined,
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
  }, [type, users.data, groups.data])

  const roleOptions: PickOption[] = useMemo(
    () =>
      (roles.data ?? [])
        .map((r) => ({
          value: r.roleid,
          label: r.roleid,
          description: `${parsePrivs(r.privs).length} 项权限`,
          group: r.special ? '内置角色' : '自定义角色',
          keywords: parsePrivs(r.privs),
        }))
        .sort((a, b) => (a.group === b.group ? a.value.localeCompare(b.value) : a.group === '自定义角色' ? -1 : 1)),
    [roles.data],
  )

  const errors = validateAclForm(form, fixed)
  const invalid = Object.keys(errors).length > 0
  const subjectsLoading = type === 'group' ? groups.isPending : users.isPending
  const label = ACL_SUBJECT_LABEL[type]
  const normalizedPath = form.path.trim() ? normalizeAclPath(form.path) : ''

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={TITLE[type]}
      description={fixed ? `路径 ${path}` : '在一个路径上给角色。'}
      submitLabel="添加"
      submitDisabled={touched && invalid}
      onSubmit={async () => {
        setTouched(true)
        if (invalid) throw new Error(Object.values(errors)[0] ?? '请检查表单')
        await runTask(updateAcl(aclAddParams(form)), {
          title: `给 ${form.subject} 添加 ${form.role}（${normalizedPath}）`,
          syncSuccessMessage: '已添加权限',
          invalidate: [accessKeys.all()],
        })
      }}
    >
      {!fixed && (
        <FormField
          label="路径"
          name="path"
          required
          error={touched ? errors.path : undefined}
          hint={normalizedPath && !errors.path ? describeAclPath(normalizedPath) : '如 /vms/100、/storage/local、/pool/开发'}
        >
          <SuggestInput
            value={form.path}
            onChange={(v) => set('path', v)}
            options={pathOptions}
            pickLabel="选择路径"
            searchPlaceholder="搜索路径或名称"
            placeholder="/"
          />
        </FormField>
      )}
      {fixed && (
        <FormField label="路径">
          <FieldInput readOnly value={path} className="bg-transparent font-mono" />
        </FormField>
      )}
      <FormField label={label} name={type === 'user' ? 'users' : type === 'group' ? 'groups' : 'tokens'} required error={touched ? errors.subject : undefined}>
        <SearchSelect
          value={form.subject || undefined}
          onValueChange={(v) => set('subject', v ?? '')}
          options={subjectOptions}
          loading={subjectsLoading}
          placeholder={!subjectsLoading && subjectOptions.length === 0 ? `没有可选的${label}` : `选择${label}`}
          searchPlaceholder={`搜索${label}`}
        />
      </FormField>
      <FormField label="角色" name="roles" required error={touched ? errors.role : undefined}>
        <SearchSelect
          value={form.role || undefined}
          onValueChange={(v) => set('role', v ?? '')}
          options={roleOptions}
          loading={roles.isPending}
          placeholder="选择角色"
          searchPlaceholder="搜索角色或权限"
        />
      </FormField>
      {!fixed && (
        <SwitchField
          label="传播"
          description="同时对下级路径生效（如 /vms 对所有客户机）。"
          checked={form.propagate}
          onCheckedChange={(v) => set('propagate', v)}
        />
      )}
    </FormDialog>
  )
}
