import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { LogOut } from 'lucide-react'

import { logout } from '@/api/auth'
import { useClusterResources } from '@/api/queries'
import { isGuest, isNode, isStorage, type ClusterResource } from '@/api/types'
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
import { byVmid, guestName, guestPath, nodePath, parseTags } from '@/lib/resources'

import { MAIN_NAV, SETTINGS_NAV } from './nav'

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

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { data: resources = [] } = useClusterResources({ enabled: open })
  const groups = useMemo(() => groupResources(resources), [resources])

  const go = (to: string) => {
    onOpenChange(false)
    navigate(to)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="top-[max(1rem,env(safe-area-inset-top))] translate-y-0 sm:top-[12vh] sm:max-w-xl"
    >
      <CommandInput placeholder="搜索虚拟机、容器、节点、存储或页面…" />
      <CommandList className="max-h-[min(60vh,28rem)]">
        <CommandEmpty>没有匹配的结果</CommandEmpty>

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
                onSelect={() => go(`/storage?node=${encodeURIComponent(s.node)}&storage=${encodeURIComponent(s.storage)}`)}
              >
                <ResourceIcon type="storage" />
                <span>{s.storage}</span>
                <span className="ml-auto text-xs text-muted-foreground">{s.node}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />
        <CommandGroup heading="页面">
          {[...MAIN_NAV, SETTINGS_NAV].map((item) => (
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
  )
}

function groupResources(resources: ClusterResource[]) {
  return {
    guests: resources.filter(isGuest).sort(byVmid),
    nodes: resources.filter(isNode).sort((a, b) => a.node.localeCompare(b.node)),
    storages: resources.filter(isStorage).sort((a, b) => a.storage.localeCompare(b.storage) || a.node.localeCompare(b.node)),
  }
}
