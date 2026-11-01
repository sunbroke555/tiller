import { Link } from 'react-router'
import { BookOpen, Building2, Keyboard, LogOut, Palette, Server, ShieldCheck, UserRound } from 'lucide-react'

import { logout } from '@/api/auth'
import { useSession } from '@/api/useSession'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

import { openShortcutsHelp } from './KeyboardShortcuts'

/** Account menu: compact round button (mobile header) or full row (sidebar). */
export function UserMenu({ variant = 'icon', className }: { variant?: 'icon' | 'row'; className?: string }) {
  const session = useSession()
  const user = session?.username ?? ''
  const at = user.lastIndexOf('@')
  const name = at > 0 ? user.slice(0, at) : user
  const realm = at > 0 ? user.slice(at + 1) : ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {variant === 'icon' ? (
          <Button variant="ghost" size="icon" className={cn('rounded-full', className)} aria-label="账户菜单">
            <UserRound />
          </Button>
        ) : (
          <button
            type="button"
            aria-label="账户菜单"
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent',
              className,
            )}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand-strong uppercase paper:bg-secondary paper:text-foreground">
              {name?.[0] ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">@{realm}</span>
            </span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={variant === 'row' ? 'top' : 'bottom'} className="w-60">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <Link to="/instances"><Server /> 实例管理</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <Link to="/account">
            <ShieldCheck /> 账户与安全
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <Link to="/settings/appearance">
            <Palette /> 外观与偏好
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <Link to="/datacenter">
            <Building2 /> 数据中心
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openShortcutsHelp()} className="pointer-coarse:hidden">
          <Keyboard /> 键盘快捷键
          <DropdownMenuShortcut>?</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="pointer-coarse:min-h-11">
          <a href="/docs/" target="_blank" rel="noopener noreferrer">
            <BookOpen /> 使用文档
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => logout()} className="pointer-coarse:min-h-11">
          <LogOut /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
