import { Link } from 'react-router'
import { Building2, LogOut, Palette, UserRound } from 'lucide-react'

import { logout } from '@/api/auth'
import { useSession } from '@/api/useSession'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** Account menu: compact round button (mobile header) or full row (sidebar). */
export function UserMenu({ variant = 'icon', className }: { variant?: 'icon' | 'row'; className?: string }) {
  const session = useSession()
  const user = session?.username ?? ''
  const [name, realm] = user.split('@')

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
            className={cn(
              'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-sidebar-accent',
              className,
            )}
          >
            <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand/15 text-sm font-semibold text-brand uppercase paper:bg-secondary paper:text-foreground">
              {name?.[0] ?? '?'}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">@{realm}</span>
            </span>
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={variant === 'row' ? 'top' : 'bottom'} className="w-56">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/appearance">
            <Palette /> 外观
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/datacenter">
            <Building2 /> 数据中心
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => logout()}>
          <LogOut /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
