// Small building blocks of the users / groups / tokens / TFA screens.

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router'
import { Check, Lock, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'

import type { UserEntry } from '@/api/access-users'
import { FieldInput, SelectField, useFieldControl } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Chip } from '@/features/guest-backup/ui'
import { cn } from '@/lib/utils'

import { expireState, splitUserid, userTfaStatus } from './model'
import { groupsPath, tfaPath, tokensPath, usersPath } from './paths'

// ------------------------------------------------------------------ nav

const VIEWS = [
  { to: usersPath(), label: '用户', match: (p: string) => p === usersPath() || p.startsWith(`${usersPath()}/user/`) },
  { to: groupsPath(), label: '组', match: (p: string) => p.startsWith(groupsPath()) },
  { to: tokensPath(), label: 'API 令牌', match: (p: string) => p.startsWith(tokensPath()) },
  { to: tfaPath(), label: '两步验证', match: (p: string) => p.startsWith(tfaPath()) },
]

export function SubNav() {
  const path = useLocation().pathname.replace(/\/+$/, '')
  return (
    <nav aria-label="用户与令牌" className="-mx-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      <ul className="flex w-max gap-1 rounded-xl bg-secondary/60 p-1 paper:bg-secondary">
        {VIEWS.map((v) => {
          const active = v.match(path)
          return (
            <li key={v.to}>
              <Link
                to={v.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-9 items-center rounded-lg px-3.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:h-10',
                  active && 'bg-background font-medium text-foreground shadow-sm paper:bg-card',
                )}
              >
                {v.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

// ------------------------------------------------------------- list card

/** Title row of a list card: title, count line, refresh, primary action. */
export function ListHeader({
  title,
  subtitle,
  fetching,
  onRefresh,
  children,
}: {
  title: ReactNode
  subtitle?: ReactNode
  fetching?: boolean
  onRefresh?: () => void
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-border/60 px-(--card-p) py-3">
      <div className="min-w-0 flex-1">
        <h2 className="heading text-base font-medium text-foreground">{title}</h2>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {onRefresh && (
        <Button variant="ghost" size="icon" aria-label="刷新" title="刷新" onClick={onRefresh} disabled={fetching} className="text-muted-foreground">
          <RefreshCw className={cn(fetching && 'animate-spin')} />
        </Button>
      )}
      {children}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label} className="pl-9" />
    </div>
  )
}

// ---------------------------------------------------------------- avatar

export function UserAvatar({ userid, muted, className }: { userid: string; muted?: boolean; className?: string }) {
  const { name } = splitUserid(userid)
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-semibold uppercase ring-1 ring-inset',
        muted
          ? 'bg-secondary text-muted-foreground ring-border'
          : 'bg-brand/10 text-brand-strong ring-brand/15 paper:bg-secondary paper:text-foreground/75 paper:ring-border',
        className,
      )}
    >
      {name[0] ?? '?'}
    </span>
  )
}

/** "alice" with a muted "@pve" after it. */
export function UserName({ userid, className }: { userid: string; className?: string }) {
  const { name, realm } = splitUserid(userid)
  return (
    <span className={cn('min-w-0 truncate', className)}>
      <span className="font-medium text-foreground">{name}</span>
      {realm && <span className="text-muted-foreground">@{realm}</span>}
    </span>
  )
}

// ----------------------------------------------------------------- chips

export function ExpireChip({ expire, hideNever = true }: { expire: number | undefined; hideNever?: boolean }) {
  const s = expireState(expire)
  if (s.kind === 'never') return hideNever ? null : <Chip>永不过期</Chip>
  if (s.kind === 'expired') return <Chip tone="danger">已过期</Chip>
  return <Chip tone={s.kind === 'soon' ? 'warning' : 'neutral'}>{s.date} 到期</Chip>
}

export function TfaChip({ user }: { user: Pick<UserEntry, 'keys' | 'tfa-locked-until' | 'totp-locked'> }) {
  const s = userTfaStatus(user)
  if (s.kind === 'none') return null
  if (s.kind === 'locked') return <Chip tone="danger" icon={<Lock />}>TFA 已锁定</Chip>
  if (s.kind === 'totp-locked') return <Chip tone="danger" icon={<Lock />}>TOTP 已锁定</Chip>
  return (
    <Chip tone="success" icon={<ShieldCheck />}>
      {s.label === '已开启' ? 'TFA' : s.label}
    </Chip>
  )
}

// ---------------------------------------------------------------- fields

/** Date input for `expire` (epoch seconds, 0 = never) with a clear button. */
export function ExpireField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <FieldInput type="date" value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1" />
      {value && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')} className="shrink-0 pointer-coarse:h-11">
          <X /> 永不过期
        </Button>
      )}
    </div>
  )
}

/** Multi-select as toggle chips (groups of a user, members of a group). */
export function ChipPicker({
  options,
  value,
  onChange,
  empty,
  label,
}: {
  options: string[]
  value: string[]
  onChange: (v: string[]) => void
  empty: ReactNode
  label: string
}) {
  const control = useFieldControl()
  if (!options.length) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <div role="group" aria-label={label} aria-describedby={control['aria-describedby']} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button
            key={o}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o].sort())}
            className={cn(
              'inline-flex h-8 items-center gap-1 rounded-full px-3 text-sm ring-1 transition-colors ring-inset pointer-coarse:h-10',
              on
                ? 'bg-brand/12 font-medium text-brand-strong ring-brand/30 paper:bg-secondary paper:text-foreground paper:ring-foreground/30'
                : 'text-muted-foreground ring-border hover:text-foreground',
            )}
          >
            {on && <Check className="size-3.5" aria-hidden />}
            {o}
          </button>
        )
      })}
    </div>
  )
}

/** Pick one user (token owner, TFA target). */
export function UserSelect({
  users,
  value,
  onChange,
  loading,
}: {
  users: string[]
  value: string
  onChange: (v: string) => void
  loading?: boolean
}) {
  return (
    <SelectField
      value={value || undefined}
      onValueChange={(v) => onChange(v ?? '')}
      options={users.map((u) => ({ value: u, label: u }))}
      loading={loading}
      placeholder="选择用户"
    />
  )
}
