// Palette commands of area tasks-logs.

import { CircleX, ListChecks, Loader, ScrollText } from 'lucide-react'

import type { CommandDef } from '@/features/command/types'
import { guestPath, nodePath } from '@/lib/resources'

export const tasksCommands: CommandDef[] = [
  {
    scope: 'global',
    id: 'tasks-cluster-log',
    label: '集群日志',
    group: '页面',
    icon: ScrollText,
    order: 600,
    keywords: ['cluster log', 'log', 'syslog', 'events', '日志'],
    run: ({ navigate }) => navigate('/cluster/log'),
  },
  {
    scope: 'global',
    id: 'tasks-running',
    label: '运行中的任务',
    group: '页面',
    icon: Loader,
    order: 610,
    keywords: ['tasks', 'running', 'active', '任务'],
    run: ({ navigate }) => navigate('/tasks?status=running'),
  },
  {
    scope: 'global',
    id: 'tasks-failed',
    label: '失败的任务',
    group: '页面',
    icon: CircleX,
    order: 620,
    keywords: ['tasks', 'failed', 'errors', '错误', '任务'],
    run: ({ navigate }) => navigate('/tasks?status=error'),
  },
  {
    scope: 'guest',
    id: 'guest-task-history',
    label: '任务历史',
    icon: ListChecks,
    order: 900,
    keywords: ['tasks', 'history', 'log', '日志'],
    run: (g, { navigate }) => navigate(guestPath(g, 'tasks')),
  },
  {
    scope: 'node',
    id: 'node-task-history',
    label: '任务历史',
    icon: ListChecks,
    order: 900,
    keywords: ['tasks', 'history', 'log', '日志'],
    run: (n, { navigate }) => navigate(nodePath(n.node, 'tasks')),
  },
]
