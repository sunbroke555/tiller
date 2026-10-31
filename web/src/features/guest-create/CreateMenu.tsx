// "新建" button with a menu: create a VM / CT, or open a template to clone it.
// Used in the overview header.

import { Link } from 'react-router'
import { Box, Monitor, Plus } from 'lucide-react'

import { useClusterResources } from '@/api/queries'
import { isGuest } from '@/api/types'
import { ResourceIcon } from '@/components/ResourceIcon'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createGuestPath, guestName, guestPath } from '@/lib/resources'
import { cn } from '@/lib/utils'

export function CreateMenu({ node, className }: { node?: string; className?: string }) {
  const { data: templates } = useClusterResources({
    select: (all) => all.filter(isGuest).filter((g) => g.template === 1).sort((a, b) => a.vmid - b.vmid),
  })
  const shown = (templates ?? []).slice(0, 6)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={cn('rounded-full max-lg:size-9 max-lg:px-0 pointer-coarse:max-lg:size-11', className)} aria-label="新建">
          <Plus />
          <span className="max-lg:hidden">新建</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuItem asChild className="py-2 pointer-coarse:py-2.5">
          <Link to={createGuestPath('qemu', node)}>
            <Monitor /> 创建虚拟机
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="py-2 pointer-coarse:py-2.5">
          <Link to={createGuestPath('lxc', node)}>
            <Box /> 创建容器
          </Link>
        </DropdownMenuItem>
        {shown.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">从模板克隆</DropdownMenuLabel>
            {shown.map((t) => (
              <DropdownMenuItem key={t.id} asChild className="py-2 pointer-coarse:py-2.5">
                <Link to={guestPath(t)}>
                  <ResourceIcon type={t.type} template />
                  <span className="truncate">{guestName(t)}</span>
                  <span className="ml-auto pl-3 text-xs text-muted-foreground tabular">{t.vmid}</span>
                </Link>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
