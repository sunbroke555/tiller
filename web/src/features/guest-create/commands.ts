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
  // On a node page (or when searching a node name): create on that node.
  {
    scope: 'node',
    id: 'create-qemu-on-node',
    // "新建…（node）": distinct from the global "创建虚拟机" in search results.
    label: '新建虚拟机',
    icon: Monitor,
    order: 400,
    keywords: ['create', 'new', 'vm', 'qemu', '新建', '创建虚拟机'],
    visible: (node) => node.status === 'online',
    run: (node, { navigate }) => navigate(createGuestPath('qemu', node.node)),
  },
  {
    scope: 'node',
    id: 'create-lxc-on-node',
    label: '新建容器',
    icon: Box,
    order: 410,
    keywords: ['create', 'new', 'ct', 'lxc', 'container', '新建', '创建容器'],
    visible: (node) => node.status === 'online',
    run: (node, { navigate }) => navigate(createGuestPath('lxc', node.node)),
  },
]
