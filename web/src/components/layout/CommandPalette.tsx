import { createContext, use, useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useMatch, useNavigate } from 'react-router'
import { Keyboard, LogOut, Zap } from 'lucide-react'
import { toast } from 'sonner'

import { logout } from '@/api/auth'
import { usePermissions } from '@/api/permissions'
import { useClusterResources } from '@/api/queries'
import { isGuest, isNode, isStorage, type ClusterResource, type GuestResource, type NodeResource } from '@/api/types'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import type { ConfirmSpec } from '@/components/page/registry'
import { ResourceIcon } from '@/components/ResourceIcon'
import { StatusDot } from '@/components/StatusDot'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { globalCommands, guestCommands, nodeCommands } from '@/features/command/registry'
import type { CommandContext } from '@/features/command/types'
import { errorMessage } from '@/lib/errors'
import { allowedFor, type PermissionChecker } from '@/lib/permissions'
import { byVmid, guestName, guestPath, nodePath, parseTags, storagePath } from '@/lib/resources'

import { openShortcutsHelp } from './KeyboardShortcuts'
import { ACCOUNT_NAV, MAIN_NAV, SETTINGS_NAV } from './nav'

interface PaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const PaletteContext = createContext<PaletteContextValue | null>(null)

export function useCommandPalette(): PaletteContextValue {
  const ctx = use(PaletteContext)
  if (!ctx) throw new Error('useCommandPalette must be used inside <CommandPaletteProvider>')
  return ctx
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const toggle = useCallback(() => setOpen((o) => !o), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        toggle()
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !isTypingTarget(e.target)) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle])
  return (
    <PaletteContext value={value}>
      {children}
      <CommandPalette open={open} onOpenChange={setOpen} />
    </PaletteContext>
  )
}

interface PendingCommand {
  label: string
  spec: ConfirmSpec
  destructive?: boolean
  run: () => unknown
}

/** One runnable palette entry (a command bound to its target). */
interface BoundCommand {
  key: string
  value: string
  label: string
  detail?: string
  icon?: ComponentType<{ className?: string }>
  destructive?: boolean
  confirm?: () => ConfirmSpec
  run: () => unknown
}

function bindGuest(g: GuestResource, ctx: CommandContext, perms: PermissionChecker): BoundCommand[] {
  return guestCommands()
    .filter(
      (c) =>
        (!c.types || c.types.includes(g.type)) &&
        (c.visible?.(g, ctx) ?? true) &&
        allowedFor(perms, c, ctx, { kind: 'guest', vmid: g.vmid, pool: g.pool }),
    )
    .map((c) => ({
      key: `${c.id}:${g.id}`,
      value: `${c.label} ${(c.keywords ?? []).join(' ')} ${g.vmid} ${guestName(g)} ${c.id}:${g.id}`,
      label: `${c.label} ${guestName(g)}`,
      detail: `${g.vmid} · ${g.node}`,
      icon: c.icon,
      destructive: c.destructive,
      confirm: c.confirm ? () => c.confirm!(g, ctx) : undefined,
      run: () => c.run(g, ctx),
    }))
}

function bindNode(n: NodeResource, ctx: CommandContext, perms: PermissionChecker): BoundCommand[] {
  return nodeCommands()
    .filter((c) => (c.visible?.(n, ctx) ?? true) && allowedFor(perms, c, ctx, { kind: 'node', node: n.node }))
    .map((c) => ({
      key: `${c.id}:${n.id}`,
      value: `${c.label} ${(c.keywords ?? []).join(' ')} ${n.node} ${c.id}:${n.id}`,
      label: `${c.label}（${n.node}）`,
      icon: c.icon,
      destructive: c.destructive,
      confirm: c.confirm ? () => c.confirm!(n, ctx) : undefined,
      run: () => c.run(n, ctx),
    }))
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { data: resources = [] } = useClusterResources({ enabled: open })
  const groups = useMemo(() => groupResources(resources), [resources])
  const [search, setSearch] = useState('')
  const [pending, setPending] = useState<PendingCommand | null>(null)
  const perms = usePermissions()
  const guestMatch = useMatch('/guest/:node/:type/:vmid/*')
  const nodeMatch = useMatch('/node/:node/*')

  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const ctx: CommandContext = { navigate, resources }
  const current = guestMatch
    ? groups.guests.find((g) => String(g.vmid) === guestMatch.params.vmid)
    : undefined
  const currentNode = nodeMatch ? groups.nodes.find((n) => n.node === nodeMatch.params.node) : undefined
  const currentCommands = current ? bindGuest(current, ctx, perms) : currentNode ? bindNode(currentNode, ctx, perms) : []
  const searching = search.trim().length > 0
  // Per-resource commands for everything only while searching (keeps the idle list short).
  const allCommands = searching
    ? [
        ...groups.guests.filter((g) => g !== current).flatMap((g) => bindGuest(g, ctx, perms)),
        ...groups.nodes.filter((n) => n !== currentNode).flatMap((n) => bindNode(n, ctx, perms)),
      ]
    : []
  const globals = globalCommands().filter((c) => (c.visible?.(ctx) ?? true) && allowedFor(perms, c, ctx, { kind: 'global' }))

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  const execute = (cmd: Pick<BoundCommand, 'label' | 'confirm' | 'run' | 'destructive'>) => {
    onOpenChange(false)
    if (cmd.confirm) {
      setPending({ label: cmd.label, spec: cmd.confirm(), destructive: cmd.destructive, run: cmd.run })
      return
    }
    Promise.resolve()
      .then(cmd.run)
      .catch((e: unknown) => toast.error(`${cmd.label}失败`, { description: errorMessage(e) }))
  }

  const renderBound = (c: BoundCommand) => (
    <CommandItem key={c.key} value={c.value} onSelect={() => execute(c)} className={c.destructive ? 'text-destructive' : undefined}>
      {c.icon ? <c.icon className="text-muted-foreground" /> : <Zap className="text-muted-foreground" />}
      <span className="truncate">{c.label}</span>
      {c.detail && <span className="ml-auto text-xs text-muted-foreground tabular">{c.detail}</span>}
    </CommandItem>
  )

  return (
    <>
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-[12vh] sm:max-w-xl"
    >
      <CommandInput placeholder="搜索资源、页面或操作…" value={search} onValueChange={setSearch} />
      <CommandList className="max-h-[min(60vh,28rem)]">
        <CommandEmpty>没有匹配的结果</CommandEmpty>

        {currentCommands.length > 0 && (
          <CommandGroup heading={`当前：${current ? guestName(current) : currentNode?.node}`}>
            {currentCommands.map(renderBound)}
          </CommandGroup>
        )}

        {groups.guests.length > 0 && (
          <CommandGroup heading="虚拟机与容器">
            {groups.guests.map((g) => (
              <CommandItem
                key={g.id}
                value={`${g.vmid} ${guestName(g)} ${g.node} ${g.type} ${parseTags(g.tags).join(' ')}`}
                onSelect={() => go(guestPath(g))}
              >
                <StatusDot status={g.status} pulse={false} decorative />
                <ResourceIcon type={g.type} template={g.template === 1} />
                <span className="truncate">{guestName(g)}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular">
                  {g.vmid} · {g.node}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.nodes.length > 0 && (
          <CommandGroup heading="节点">
            {groups.nodes.map((n) => (
              <CommandItem key={n.id} value={`node ${n.node} 节点`} onSelect={() => go(nodePath(n.node))}>
                <StatusDot status={n.status} pulse={false} decorative />
                <ResourceIcon type="node" />
                <span>{n.node}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {groups.storages.length > 0 && (
          <CommandGroup heading="存储">
            {groups.storages.map((s) => (
              <CommandItem
                key={s.id}
                value={`storage ${s.storage} ${s.node} ${s.plugintype ?? ''} 存储`}
                onSelect={() => go(storagePath(s.node, s.storage))}
              >
                <ResourceIcon type="storage" />
                <span>{s.storage}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.node}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {allCommands.length > 0 && <CommandGroup heading="操作">{allCommands.map(renderBound)}</CommandGroup>}

        {globals.length > 0 && (
          <CommandGroup heading="快捷操作">
            {globals.map((c) => (
              <CommandItem
                key={c.id}
                value={`${c.label} ${(c.keywords ?? []).join(' ')} ${c.id}`}
                onSelect={() =>
                  execute({
                    label: c.label,
                    destructive: c.destructive,
                    confirm: c.confirm ? () => c.confirm!(ctx) : undefined,
                    run: () => c.run(ctx),
                  })
                }
              >
                {c.icon ? <c.icon className="text-muted-foreground" /> : <Zap className="text-muted-foreground" />}
                <span>{c.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="页面">
          {[...MAIN_NAV, SETTINGS_NAV, ACCOUNT_NAV].map((item) => (
            <CommandItem
              key={item.to}
              value={`${item.label} ${(item.keywords ?? []).join(' ')}`}
              onSelect={() => go(item.to)}
            >
              <item.icon className="text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
          <CommandItem
            value="键盘快捷键 keyboard shortcuts hotkeys help"
            onSelect={() => {
              onOpenChange(false)
              openShortcutsHelp()
            }}
          >
            <Keyboard className="text-muted-foreground" />
            <span>键盘快捷键</span>
            <kbd className="ml-auto rounded-md border border-border px-1.5 font-mono text-[10px] text-muted-foreground">?</kbd>
          </CommandItem>
          <CommandItem
            value="退出登录 logout sign out"
            onSelect={() => {
              onOpenChange(false)
              logout()
            }}
          >
            <LogOut className="text-muted-foreground" />
            <span>退出登录</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(o) => !o && setPending(null)}
      title={pending?.spec.title ?? ''}
      description={pending?.spec.description}
      confirmLabel={pending?.spec.confirmLabel ?? pending?.label}
      destructive={pending?.spec.destructive ?? pending?.destructive}
      typeToConfirm={pending?.spec.typeToConfirm}
      onConfirm={() => pending?.run() as Promise<unknown> | void}
    />
    </>
  )
}

function groupResources(resources: ClusterResource[]) {
  return {
    guests: resources.filter(isGuest).sort(byVmid),
    nodes: resources.filter(isNode).sort((a, b) => a.node.localeCompare(b.node)),
    storages: resources.filter(isStorage).sort((a, b) => a.storage.localeCompare(b.storage) || a.node.localeCompare(b.node)),
  }
}
