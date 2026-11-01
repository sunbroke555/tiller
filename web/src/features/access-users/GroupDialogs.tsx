import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { accessKeys, createGroup, updateGroup, updateUser, type UserConfig } from '@/api/access-users'
import { get, p } from '@/api/client'
import { FieldInput, FormDialog, FormField } from '@/components/form'

import { groupIdError, groupsWith } from './model'
import { ChipPicker } from './ui'

/** Create (groupid null) or edit a group's comment (PVE.dc.GroupEdit). */
export function GroupEditDialog({
  groupid,
  comment: initialComment,
  open,
  onOpenChange,
  onCreated,
}: {
  groupid: string | null
  comment?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated?: (groupid: string) => void
}) {
  const queryClient = useQueryClient()
  const [id, setId] = useState('')
  const [comment, setComment] = useState('')
  useEffect(() => {
    if (open) {
      setId('')
      setComment(initialComment ?? '')
    }
  }, [open, initialComment])
  const idErr = groupIdError(id)
  const create = groupid === null
  const ready = create ? !!id && !idErr : comment.trim() !== (initialComment ?? '').trim()

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={groupid === null ? '新建组' : `编辑组 ${groupid}`}
      submitLabel={create ? '创建' : '保存'}
      submitDisabled={!ready}
      onSubmit={async () => {
        if (groupid === null) {
          await createGroup({ groupid: id, comment: comment.trim() || undefined })
          toast.success(`已创建组 ${id}`)
          onCreated?.(id)
        } else {
          await updateGroup(groupid, { comment: comment.trim() })
          toast.success('已保存')
        }
        void queryClient.invalidateQueries({ queryKey: accessKeys.all() })
      }}
    >
      {create && (
        <FormField label="组名" name="groupid" required error={idErr}>
          <FieldInput value={id} onChange={(e) => setId(e.target.value.trim())} autoCapitalize="off" autoCorrect="off" spellCheck={false} autoFocus />
        </FormField>
      )}
      <FormField label="备注" name="comment">
        <FieldInput value={comment} onChange={(e) => setComment(e.target.value)} autoFocus={!create} />
      </FormField>
    </FormDialog>
  )
}

/**
 * Change a group's members. PVE keeps membership on the users, so every
 * added or removed user gets PUT /access/users/{userid} groups=… (read fresh
 * first, so other group memberships stay as they are).
 */
export async function setMembership(userid: string, groupid: string, member: boolean): Promise<void> {
  const config = await get<UserConfig>(p`/access/users/${userid}`)
  await updateUser(userid, { groups: groupsWith(config.groups ?? [], groupid, member) })
}

export function AddMembersDialog({
  groupid,
  candidates,
  open,
  onOpenChange,
}: {
  groupid: string
  /** Users not in the group yet. */
  candidates: string[]
  open: boolean
  onOpenChange: (o: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<string[]>([])
  useEffect(() => {
    if (open) setPicked([])
  }, [open])

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加成员"
      description={`加入组 ${groupid}`}
      submitLabel={picked.length ? `添加 ${picked.length} 个用户` : '添加'}
      submitDisabled={!picked.length}
      onSubmit={async () => {
        const failed: string[] = []
        for (const u of picked) {
          try {
            await setMembership(u, groupid, true)
          } catch (e) {
            failed.push(`${u}：${e instanceof Error ? e.message : String(e)}`)
          }
        }
        void queryClient.invalidateQueries({ queryKey: accessKeys.all() })
        if (failed.length === picked.length) throw new Error(failed.join('；'))
        if (failed.length) toast.error(`部分用户没有加入：${failed.join('；')}`)
        else toast.success(`已添加 ${picked.length} 个成员`)
      }}
    >
      <FormField label="用户">
        <ChipPicker label="用户" options={candidates} value={picked} onChange={setPicked} empty="所有用户都已经在这个组里" />
      </FormField>
    </FormDialog>
  )
}
