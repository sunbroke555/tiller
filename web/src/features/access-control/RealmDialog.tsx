// Create / edit an authentication realm (PVE.dc.AuthEditBase with the
// per-type input panels). LDAP and AD have a second page for the sync
// options; PAM and PVE only have comment, default flag and TFA.

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

import { createRealm, realmInvalidate, updateRealm, useRealmConfig, useRealms } from '@/api/access-control'
import { CheckboxField, FieldInput, FormDialog, FormField, FormRow, FormSection, SelectField, SwitchField, type SelectOption } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SuggestInput } from '@/features/firewall/pickers'

import {
  realmParams,
  realmSupportsSync,
  realmSupportsTfa,
  realmToForm,
  realmTypeLabel,
  validateRealmForm,
  type LdapMode,
  type RealmForm,
  type RemoveVanished,
  type SyncScope,
  type TfaType,
} from './logic'

export interface RealmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: string
  /** Edit this realm; create when missing. */
  realm?: string | null
}

const MODE_OPTIONS: SelectOption<Exclude<LdapMode, ''>>[] = [
  { value: 'ldap', label: 'LDAP', description: '明文' },
  { value: 'ldap+starttls', label: 'STARTTLS' },
  { value: 'ldaps', label: 'LDAPS' },
]

const TFA_OPTIONS: SelectOption<Exclude<TfaType, ''>>[] = [
  { value: 'oath', label: 'OATH / TOTP' },
  { value: 'yubico', label: 'Yubico' },
]

const SCOPE_OPTIONS: SelectOption<Exclude<SyncScope, ''>>[] = [
  { value: 'users', label: '用户' },
  { value: 'groups', label: '组' },
  { value: 'both', label: '用户和组' },
]

const ENABLE_NEW_OPTIONS: SelectOption<'1' | '0'>[] = [
  { value: '1', label: '是' },
  { value: '0', label: '否' },
]

const CLAIM_OPTIONS = ['subject', 'username', 'email'].map((v) => ({ value: v, label: v }))
const PROMPT_OPTIONS = ['none', 'login', 'consent', 'select_account'].map((v) => ({ value: v, label: v }))

export function RealmDialog({ open, onOpenChange, type, realm }: RealmDialogProps) {
  const isCreate = !realm
  const config = useRealmConfig(open && realm ? realm : null)
  const realms = useRealms(open && isCreate)
  const [form, setForm] = useState<RealmForm>(() => realmToForm(null))
  const [loaded, setLoaded] = useState(false)
  const [touched, setTouched] = useState(false)
  const [tab, setTab] = useState('general')

  useEffect(() => {
    if (!open) return
    setForm(realmToForm(null))
    setLoaded(isCreate)
    setTouched(false)
    setTab('general')
    // Reset when the dialog opens.
  }, [open])
  useEffect(() => {
    if (open && !isCreate && config.data && !loaded) {
      setForm(realmToForm(config.data, realm))
      setLoaded(true)
    }
  }, [open, isCreate, config.data, loaded, realm])

  const set = <K extends keyof RealmForm>(key: K, value: RealmForm[K]) => setForm((f) => ({ ...f, [key]: value }))
  const setTfa = (patch: Partial<RealmForm['tfa']>) => setForm((f) => ({ ...f, tfa: { ...f.tfa, ...patch } }))
  const setSync = (patch: Partial<RealmForm['syncDefaults']>) => setForm((f) => ({ ...f, syncDefaults: { ...f.syncDefaults, ...patch } }))
  const setVanished = (key: keyof RemoveVanished, v: boolean) =>
    setForm((f) => ({ ...f, syncDefaults: { ...f.syncDefaults, removeVanished: { ...f.syncDefaults.removeVanished, [key]: v } } }))

  const errors = validateRealmForm(type, form, isCreate)
  if (isCreate && form.realm.trim() && (realms.data ?? []).some((r) => r.realm === form.realm.trim())) errors.realm = '已有同名认证域'
  const invalid = Object.keys(errors).length > 0
  const changes = !isCreate && config.data && loaded ? realmParams(type, form, config.data) : null
  const err = (k: string) => (touched ? errors[k] : undefined)
  const ldapLike = type === 'ldap' || type === 'ad'
  const syncPage = realmSupportsSync(type)
  const tls = form.mode === 'ldaps' || form.mode === 'ldap+starttls'

  const general = (
    <>
      <FormRow>
        <FormField label="名称" name="realm" required={isCreate} error={err('realm')}>
          <FieldInput
            value={form.realm}
            onChange={(e) => set('realm', e.target.value)}
            readOnly={!isCreate}
            className={!isCreate ? 'bg-transparent' : undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </FormField>
        {type === 'ldap' && (
          <FormField label="Base DN" name="base_dn" required error={err('base_dn')}>
            <FieldInput value={form.base_dn} onChange={(e) => set('base_dn', e.target.value)} placeholder="CN=Users,DC=Company,DC=net" spellCheck={false} />
          </FormField>
        )}
        {type === 'ad' && (
          <FormField label="域名" name="domain" required error={err('domain')}>
            <FieldInput value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="company.net" spellCheck={false} autoCapitalize="off" />
          </FormField>
        )}
        {type === 'openid' && (
          <FormField label="Issuer URL" name="issuer-url" required error={err('issuer-url')}>
            <FieldInput value={form.issuerUrl} onChange={(e) => set('issuerUrl', e.target.value)} placeholder="https://auth.example.com/realms/pve" inputMode="url" spellCheck={false} autoCapitalize="off" />
          </FormField>
        )}
      </FormRow>

      {type === 'ldap' && (
        <FormField label="用户属性" name="user_attr" required error={err('user_attr')}>
          <FieldInput value={form.user_attr} onChange={(e) => set('user_attr', e.target.value)} placeholder="uid / sAMAccountName" spellCheck={false} autoCapitalize="off" />
        </FormField>
      )}
      {type === 'ad' && (
        <SwitchField label="区分大小写" description="用户名按大小写区分（默认开启）。" checked={form.caseSensitive} onCheckedChange={(v) => set('caseSensitive', v)} />
      )}

      {ldapLike && (
        <>
          <FormRow>
            <FormField label="服务器" name="server1" required error={err('server1')}>
              <FieldInput value={form.server1} onChange={(e) => set('server1', e.target.value)} placeholder="ldap.example.com" spellCheck={false} autoCapitalize="off" />
            </FormField>
            <FormField label="备用服务器" name="server2">
              <FieldInput value={form.server2} onChange={(e) => set('server2', e.target.value)} spellCheck={false} autoCapitalize="off" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="端口" name="port" error={err('port')}>
              <FieldInput value={form.port} onChange={(e) => set('port', e.target.value.replace(/[^\d]/g, ''))} placeholder="默认" inputMode="numeric" />
            </FormField>
            <FormField label="模式" name="mode">
              <SelectField
                value={form.mode || undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, mode: v ?? '', verify: v === 'ldaps' || v === 'ldap+starttls' ? f.verify : false }))}
                options={MODE_OPTIONS}
                emptyOption="默认 (LDAP)"
                aria-label="模式"
              />
            </FormField>
          </FormRow>
          <SwitchField
            label="验证证书"
            description={tls ? '校验服务器的 TLS 证书。' : '只在 STARTTLS 或 LDAPS 模式下可用。'}
            checked={form.verify}
            onCheckedChange={(v) => set('verify', v)}
            disabled={!tls}
          />
        </>
      )}

      {type === 'openid' && (
        <>
          <FormRow>
            <FormField label="Client ID" name="client-id" required error={err('client-id')}>
              <FieldInput value={form.clientId} onChange={(e) => set('clientId', e.target.value)} spellCheck={false} autoCapitalize="off" />
            </FormField>
            <FormField label="Client Key" name="client-key">
              <FieldInput value={form.clientKey} onChange={(e) => set('clientKey', e.target.value)} spellCheck={false} autoCapitalize="off" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="Scopes" name="scopes">
              <FieldInput value={form.scopes} onChange={(e) => set('scopes', e.target.value)} placeholder="默认 (email profile)" spellCheck={false} autoCapitalize="off" />
            </FormField>
            <FormField label="用户名声明" name="username-claim" hint={isCreate ? '创建后不能修改' : undefined}>
              {isCreate ? (
                <SuggestInput value={form.usernameClaim} onChange={(v) => set('usernameClaim', v)} options={CLAIM_OPTIONS} pickLabel="选择用户名声明" placeholder="默认 (subject)" />
              ) : (
                <FieldInput readOnly value={form.usernameClaim || '默认 (subject)'} className="bg-transparent" />
              )}
            </FormField>
          </FormRow>
          <SwitchField label="自动创建用户" description="首次登录时自动创建 PVE 用户。" checked={form.autocreate} onCheckedChange={(v) => set('autocreate', v)} />
          <FormRow>
            <FormField label="组声明" name="groups-claim" error={err('groups-claim')}>
              <FieldInput value={form.groupsClaim} onChange={(e) => set('groupsClaim', e.target.value)} placeholder="默认（无）" spellCheck={false} autoCapitalize="off" />
            </FormField>
            <FormField label="Prompt" name="prompt">
              <SuggestInput value={form.prompt} onChange={(v) => set('prompt', v)} options={PROMPT_OPTIONS} pickLabel="选择 prompt" placeholder="由认证服务决定" />
            </FormField>
          </FormRow>
          <SwitchField label="自动创建组" checked={form.groupsAutocreate} onCheckedChange={(v) => set('groupsAutocreate', v)} />
          <SwitchField label="覆盖组" description="登录时用声明中的组替换用户现有的组。" checked={form.groupsOverwrite} onCheckedChange={(v) => set('groupsOverwrite', v)} />
        </>
      )}

      <SwitchField label="默认认证域" description="登录页默认选中这个认证域。" checked={form.default} onCheckedChange={(v) => set('default', v)} />

      {realmSupportsTfa(type) && (
        <div className="grid gap-4">
          <FormField label="要求两步验证" name="tfa" hint="对这个认证域的所有用户强制使用。">
            <SelectField value={form.tfa.type || undefined} onValueChange={(v) => setTfa({ type: v ?? '' })} options={TFA_OPTIONS} emptyOption="不要求" aria-label="要求两步验证" />
          </FormField>
          {form.tfa.type === 'oath' && (
            <FormRow>
              <FormField label="时间步长" error={err('tfaStep')}>
                <FieldInput value={form.tfa.step} onChange={(e) => setTfa({ step: e.target.value.replace(/[^\d]/g, '') })} placeholder="默认 (30)" inputMode="numeric" />
              </FormField>
              <FormField label="密码位数" error={err('tfaDigits')}>
                <FieldInput value={form.tfa.digits} onChange={(e) => setTfa({ digits: e.target.value.replace(/[^\d]/g, '') })} placeholder="默认 (6)" inputMode="numeric" />
              </FormField>
            </FormRow>
          )}
          {form.tfa.type === 'yubico' && (
            <>
              <FormRow>
                <FormField label="Yubico API ID" required error={err('tfaId')}>
                  <FieldInput value={form.tfa.id} onChange={(e) => setTfa({ id: e.target.value })} spellCheck={false} />
                </FormField>
                <FormField label="Yubico API Key" required error={err('tfaKey')}>
                  <FieldInput value={form.tfa.key} onChange={(e) => setTfa({ key: e.target.value })} spellCheck={false} />
                </FormField>
              </FormRow>
              <FormField label="Yubico URL">
                <FieldInput value={form.tfa.url} onChange={(e) => setTfa({ url: e.target.value })} placeholder="默认" inputMode="url" spellCheck={false} />
              </FormField>
            </>
          )}
        </div>
      )}

      <FormField label="备注" name="comment">
        <FieldInput value={form.comment} onChange={(e) => set('comment', e.target.value)} />
      </FormField>

      {(ldapLike || type === 'openid') && (
        <FormSection title="高级选项" collapsible>
          {ldapLike && (
            <SwitchField label="检查连接" description="保存时验证服务器和绑定账号能否连通。" checked={form.checkConnection} onCheckedChange={(v) => set('checkConnection', v)} />
          )}
          {type === 'openid' && (
            <>
              <FormRow>
                <FormField label="ACR Values" name="acr-values">
                  <FieldInput value={form.acrValues} onChange={(e) => set('acrValues', e.target.value)} spellCheck={false} />
                </FormField>
                <FormField label="Audiences" name="audiences">
                  <FieldInput value={form.audiences} onChange={(e) => set('audiences', e.target.value)} spellCheck={false} />
                </FormField>
              </FormRow>
              <SwitchField label="查询 userinfo 端点" checked={form.queryUserinfo} onCheckedChange={(v) => set('queryUserinfo', v)} />
            </>
          )}
        </FormSection>
      )}
    </>
  )

  const sync = (
    <>
      <FormRow>
        <FormField label="绑定用户" name="bind_dn">
          <FieldInput value={form.bind_dn} onChange={(e) => set('bind_dn', e.target.value)} placeholder="无" spellCheck={false} autoCapitalize="off" />
        </FormField>
        <FormField label="绑定密码" name="password" hint={!isCreate && config.data?.bind_dn ? '留空表示不修改' : undefined}>
          <FieldInput type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder={isCreate ? '' : '不修改'} autoComplete="new-password" />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="邮箱属性" name="sync_attributes">
          <FieldInput value={form.emailAttr} onChange={(e) => set('emailAttr', e.target.value)} placeholder="mail" spellCheck={false} autoCapitalize="off" />
        </FormField>
        <FormField label="组名属性" name="group_name_attr">
          <FieldInput value={form.group_name_attr} onChange={(e) => set('group_name_attr', e.target.value)} placeholder="cn" spellCheck={false} autoCapitalize="off" />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="用户类" name="user_classes">
          <FieldInput value={form.user_classes} onChange={(e) => set('user_classes', e.target.value)} placeholder="inetorgperson, posixaccount, person, user" spellCheck={false} autoCapitalize="off" />
        </FormField>
        <FormField label="组类" name="group_classes">
          <FieldInput value={form.group_classes} onChange={(e) => set('group_classes', e.target.value)} placeholder="groupOfNames, group, univentionGroup, ipausergroup" spellCheck={false} autoCapitalize="off" />
        </FormField>
      </FormRow>
      <FormRow>
        <FormField label="用户过滤" name="filter">
          <FieldInput value={form.filter} onChange={(e) => set('filter', e.target.value)} placeholder="(memberOf=cn=pve,ou=groups,dc=example,dc=com)" spellCheck={false} autoCapitalize="off" />
        </FormField>
        <FormField label="组过滤" name="group_filter">
          <FieldInput value={form.group_filter} onChange={(e) => set('group_filter', e.target.value)} spellCheck={false} autoCapitalize="off" />
        </FormField>
      </FormRow>
      <FormSection title="默认同步选项">
        <FormRow>
          <FormField label="范围" name="scope">
            <SelectField value={form.syncDefaults.scope || undefined} onValueChange={(v) => setSync({ scope: v ?? '' })} options={SCOPE_OPTIONS} emptyOption="无" aria-label="默认同步范围" />
          </FormField>
          <FormField label="启用新用户" name="enable-new">
            <SelectField value={form.syncDefaults.enableNew || undefined} onValueChange={(v) => setSync({ enableNew: v ?? '' })} options={ENABLE_NEW_OPTIONS} emptyOption="默认（是）" aria-label="默认启用新用户" />
          </FormField>
        </FormRow>
        <RemoveVanishedFields value={form.syncDefaults.removeVanished} onChange={setVanished} />
      </FormSection>
    </>
  )

  const loading = !isCreate && !loaded

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={isCreate ? `添加 ${realmTypeLabel(type)} 认证域` : `编辑认证域 ${realm}`}
      description={isCreate ? undefined : realmTypeLabel(type)}
      submitLabel={isCreate ? '添加' : '保存'}
      submitDisabled={loading || (touched && invalid) || (!isCreate && !changes)}
      onSubmit={async () => {
        setTouched(true)
        if (invalid) {
          if (syncPage && tab !== 'general') setTab('general')
          throw new Error(Object.values(errors)[0] ?? '请检查表单')
        }
        const params = realmParams(type, form, isCreate ? null : (config.data ?? null))
        if (!params) return
        const name = isCreate ? form.realm.trim() : realm
        await runTask(isCreate ? createRealm(params) : updateRealm(realm, params), {
          title: `${isCreate ? '添加' : '修改'}认证域 ${name}`,
          syncSuccessMessage: `已${isCreate ? '添加' : '保存'}认证域 ${name}`,
          invalidate: realmInvalidate,
        })
      }}
    >
      {loading ? (
        config.isError ? (
          <p className="py-6 text-center text-sm text-destructive">无法读取认证域配置。</p>
        ) : (
          <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            正在读取…
          </p>
        )
      ) : syncPage ? (
        <Tabs value={tab} onValueChange={setTab} className="gap-4">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="general" className="flex-1 sm:flex-none">
              常规
            </TabsTrigger>
            <TabsTrigger value="sync" className="flex-1 sm:flex-none">
              同步选项
            </TabsTrigger>
          </TabsList>
          <TabsContent value="general" forceMount hidden={tab !== 'general'} className="grid gap-5">
            {general}
          </TabsContent>
          <TabsContent value="sync" forceMount hidden={tab !== 'sync'} className="grid gap-5">
            {sync}
          </TabsContent>
        </Tabs>
      ) : (
        general
      )}
    </FormDialog>
  )
}

export function RemoveVanishedFields({
  value,
  onChange,
  legend = '移除已消失的',
}: {
  value: RemoveVanished
  onChange: (key: keyof RemoveVanished, v: boolean) => void
  legend?: ReactNode
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <CheckboxField label="ACL" description="删除已消失用户和组的权限条目。" checked={value.acl} onCheckedChange={(v) => onChange('acl', v)} />
      <CheckboxField label="条目" description="删除目录中已不存在的用户和组。" checked={value.entry} onCheckedChange={(v) => onChange('entry', v)} />
      <CheckboxField label="属性" description="清除同步用户上目录中已没有的属性。" checked={value.properties} onCheckedChange={(v) => onChange('properties', v)} />
    </fieldset>
  )
}
