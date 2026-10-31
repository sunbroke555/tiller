// Palette commands of area guest-create.

import { Box, Monitor } from 'lucide-react'

import type { CommandDef } from '@/features/command/types'
import { createGuestPath } from '@/lib/resources'

export const guestCreateCommands: CommandDef[] = [
  {
    scope: 'global',
    id: 'create-qemu',
    label: '创建虚拟机',
    icon: Monitor,
    order: 100,
    keywords: ['create', 'new', 'vm', 'qemu', '新建'],
    run: ({ navigate }) => navigate(createGuestPath('qemu')),
  },
  {
    scope: 'global',
    id: 'create-lxc',
    label: '创建容器',
    icon: Box,
    order: 110,
    keywords: ['create', 'new', 'ct', 'lxc', 'container', '新建'],
    run: ({ navigate }) => navigate(createGuestPath('lxc')),
  },
]
