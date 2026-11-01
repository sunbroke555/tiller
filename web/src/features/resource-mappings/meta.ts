// Labels of the mapping kinds and the shared write helper.

import { Cpu, FolderTree, Usb, type LucideIcon } from 'lucide-react'

import { mappingKeys, type MappingKind } from '@/api/resource-mappings'
import { runTask } from '@/components/tasks/tracker'

/** `noun` starts with a space when it starts with Latin letters, so "添加{noun}" reads "添加 PCI 映射". */
export const KIND_META: Record<MappingKind, { title: string; icon: LucideIcon; empty: string; noun: string }> = {
  pci: { title: 'PCI 映射', icon: Cpu, noun: ' PCI 映射', empty: '把各节点上的 PCI 设备（显卡、网卡…）登记成一个名字，虚拟机直通时引用它，迁移到其他节点也能找到对应设备。' },
  usb: { title: 'USB 映射', icon: Usb, noun: ' USB 映射', empty: '按设备 ID 或 USB 端口登记各节点上的 USB 设备，虚拟机直通时引用它。' },
  dir: { title: '目录映射', icon: FolderTree, noun: '目录映射', empty: '登记各节点上的主机目录，虚拟机通过 virtiofs 共享它。' },
}

/** Write to /cluster/mapping and refresh every mapping list (also the VM editors'). */
export async function mappingWrite(start: Promise<unknown>, title: string): Promise<void> {
  await runTask(start, { title, invalidate: [mappingKeys.all], syncSuccessMessage: `${title}：已保存` })
}
