// Create / edit a custom role (PVE.dc.RoleEdit); built-in roles open read-only.

import { useEffect, useState } from 'react'

import { accessKeys, createRole, updateRole, useAllPrivileges, useRole, useRoles, type RoleInfo } from '@/api/access-control'
import { FieldInput, FormDialog, FormField } from '@/components/form'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'

import { parsePrivs, roleCreateParams, roleIdError, roleUpdateParams } from './logic'
import { PrivilegePicker } from './PrivilegePicker'

export interface RoleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this role; create when missing. */
  role?: RoleInfo | null
  /** Create: start from these privileges ("复制为新角色"). */
  initialPrivs?: readonly string[]
}

export function RoleDialog({ open, onOpenChange, role, initialPrivs }: RoleDialogProps) {
  const isCreate = !role
  const all = useAllPrivileges(open)
  const roles = useRoles(open && isCreate)
  // Edit: the role's current privileges (GET /access/roles/{id}).
  const fresh = useRole(open && role ? role.roleid : null)
  const before = fresh.data ? Object.keys(fresh.data).sort() : role ? parsePrivs(role.privs) : []

  const [roleid, setRoleid] = useState('')
  const [privs, setPrivs] = useState<string[]>([])
  const [touched, setTouched] = useState(false)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!open) return
    setRoleid('')
    setPrivs(role ? parsePrivs(role.privs) : [...(initialPrivs ?? [])])
    setTouched(false)
    setLoaded(false)
    // Reset when the dialog opens.
  }, [open])
  // Take the fresh privilege list once it arrives (unless the user already changed something).
  useEffect(() => {
    if (open && role && fresh.data && !loaded) {
      setPrivs(Object.keys(fresh.data).sort())
      setLoaded(true)
    }
  }, [open, role, fresh.data, loaded])

  const idError = isCreate ? roleIdError(roleid, (roles.data ?? []).map((r) => r.roleid)) : null
  const privError = privs.length === 0 ? '至少选择一项权限' : null
  const changes = !isCreate ? roleUpdateParams(before, privs) : null

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isCreate ? '创建角色' : `编辑角色 ${role.roleid}`}
      description={isCreate ? '角色是一组权限，在“权限”里把角色分配给用户、组或 API 令牌。' : '修改后，所有使用这个角色的权限条目立即生效。'}
      submitLabel={isCreate ? '创建' : '保存'}
      submitDisabled={(touched && (!!idError || !!privError)) || (!isCreate && !changes)}
      onSubmit={async () => {
        setTouched(true)
        if (idError || privError) throw new Error(idError ?? privError ?? '请检查表单')
        if (isCreate) {
          await runTask(createRole(roleCreateParams(roleid, privs)), {
            title: `创建角色 ${roleid.trim()}`,
            syncSuccessMessage: `已创建角色 ${roleid.trim()}`,
            invalidate: [accessKeys.roles()],
          })
        } else if (changes) {
          await runTask(updateRole(role.roleid, changes), {
            title: `修改角色 ${role.roleid}`,
            syncSuccessMessage: `已保存角色 ${role.roleid}`,
            invalidate: [accessKeys.roles(), accessKeys.all()],
          })
        }
      }}
    >
      {isCreate && (
        <FormField label="名称" name="roleid" required error={touched || roleid ? (idError ?? undefined) : undefined} hint="字母、数字、点、短横线、下划线；不能以 PVE 开头">
          <FieldInput value={roleid} onChange={(e) => setRoleid(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus />
        </FormField>
      )}
      <FormField label="权限" name="privs" required error={touched ? (privError ?? undefined) : undefined}>
        <PrivilegePicker all={all.data ?? []} value={privs} onChange={setPrivs} invalid={touched && !!privError} />
      </FormField>
    </FormDialog>
  )
}

/** A built-in role: its privileges, read-only. */
export function BuiltinRoleDialog({
  open,
  onOpenChange,
  role,
  onClone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: RoleInfo | null
  onClone?: () => void
}) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={role ? `内置角色 ${role.roleid}` : '内置角色'}
      description="内置角色不能修改或删除。需要不同的组合时，复制为新角色再调整。"
      footer={
        <>
          {onClone && (
            <Button variant="outline" onClick={onClone}>
              复制为新角色
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>关闭</Button>
        </>
      }
    >
      <div className="pt-1 pb-2">
        <PrivilegePicker all={[]} value={parsePrivs(role?.privs)} readOnly />
      </div>
    </ResponsiveDialog>
  )
}
