// Sync an LDAP / AD realm now (PVE.dc.SyncWindow): scope, enable new users,
// what to remove; "预览" runs a dry-run and opens its log.

import { useEffect, useState } from 'react'
import { Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { accessKeys, realmInvalidate, syncRealm, useRealmConfig } from '@/api/access-control'
import { parseUpid } from '@/api/tasks'
import { FormDialog, FormField, FormRow, SelectField, type SelectOption } from '@/components/form'
import { openTaskLog, runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Notice } from '@/features/replication/ui'
import { errorMessage } from '@/lib/errors'

import { syncFormFromDefaults, syncParams, type RemoveVanished, type SyncForm, type SyncScope } from './logic'
import { RemoveVanishedFields } from './RealmDialog'

const SCOPE_OPTIONS: SelectOption<Exclude<SyncScope, ''>>[] = [
  { value: 'users', label: '用户' },
  { value: 'groups', label: '组' },
  { value: 'both', label: '用户和组' },
]

const YES_NO: SelectOption<'1' | '0'>[] = [
  { value: '1', label: '是' },
  { value: '0', label: '否' },
]

export function SyncDialog({ open, onOpenChange, realm }: { open: boolean; onOpenChange: (o: boolean) => void; realm: string }) {
  const config = useRealmConfig(open ? realm : null)
  const [form, setForm] = useState<SyncForm>({ scope: '', enableNew: '1', removeVanished: { acl: false, entry: false, properties: false } })
  const [loaded, setLoaded] = useState(false)
  const [touched, setTouched] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  useEffect(() => {
    if (open) {
      setLoaded(false)
      setTouched(false)
    }
  }, [open])
  useEffect(() => {
    if (open && (config.data || config.isError) && !loaded) {
      setForm(syncFormFromDefaults(config.data ?? null))
      setLoaded(true)
    }
  }, [open, config.data, config.isError, loaded])

  const hasDefaults = !!config.data?.['sync-defaults-options']
  const scopeError = form.scope ? null : '请选择范围'
  const destructive = form.removeVanished.entry || form.removeVanished.acl

  const start = async (dryRun: boolean) => {
    const handle = await runTask(syncRealm(realm, syncParams(form, dryRun)), {
      title: `${dryRun ? '预览同步' : '同步'}认证域 ${realm}`,
      invalidate: dryRun ? [] : [...realmInvalidate, accessKeys.all()],
    })
    if (handle.upid) openTaskLog({ node: parseUpid(handle.upid)?.node ?? '', upid: handle.upid, title: `${dryRun ? '预览同步' : '同步'} ${realm}` })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`同步认证域 ${realm}`}
      description="从目录服务器把用户和组同步到 PVE。同步的组名为“组名-认证域”。"
      submitLabel="同步"
      submitDisabled={!loaded || (touched && !!scopeError) || previewing}
      onSubmit={async () => {
        setTouched(true)
        if (scopeError) throw new Error(scopeError)
        await start(false)
      }}
      footerExtra={
        <Button
          type="button"
          variant="outline"
          disabled={!loaded || previewing}
          onClick={async () => {
            setTouched(true)
            if (scopeError) return
            setPreviewing(true)
            try {
              await start(true)
            } catch (e) {
              toast.error('预览失败', { description: errorMessage(e) })
            } finally {
              setPreviewing(false)
            }
          }}
        >
          {previewing ? <Loader2 className="animate-spin" /> : <Eye />}
          预览
        </Button>
      }
    >
      {!loaded ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          正在读取默认同步选项…
        </p>
      ) : (
        <>
          <FormRow>
            <FormField label="范围" name="scope" required error={touched ? (scopeError ?? undefined) : undefined}>
              <SelectField
                value={form.scope || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, scope: v ?? '' }))}
                options={SCOPE_OPTIONS}
                placeholder="选择范围"
                aria-label="同步范围"
              />
            </FormField>
            <FormField label="启用新用户" name="enable-new">
              <SelectField value={form.enableNew} onValueChange={(v) => setForm((f) => ({ ...f, enableNew: v ?? '1' }))} options={YES_NO} aria-label="启用新用户" />
            </FormField>
          </FormRow>
          <RemoveVanishedFields
            value={form.removeVanished}
            onChange={(k: keyof RemoveVanished, v) => setForm((f) => ({ ...f, removeVanished: { ...f.removeVanished, [k]: v } }))}
          />
          {destructive && <Notice tone="warning">会删除目录中已不存在的{form.removeVanished.entry ? '用户和组' : '用户和组的权限'}。建议先预览。</Notice>}
          {!hasDefaults && <p className="text-xs text-muted-foreground">默认同步选项可以在编辑认证域的“同步选项”里设置。</p>}
        </>
      )}
    </FormDialog>
  )
}
