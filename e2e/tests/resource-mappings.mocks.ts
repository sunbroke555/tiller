import type { Page } from '@playwright/test'

// page.route() mocks for the resource mapping screens: a GPU host with
// IOMMU groups and mdev support, a couple of USB devices, mappings in every
// state and two custom CPU models. Used by the phone tests and the
// screenshot spec (the nested lab has no GPUs or USB devices to pass through).

export function mockPciDevices() {
  return [
    { id: '0000:00:02.0', class: '0x030000', vendor: '0x8086', device: '0x3e92', vendor_name: 'Intel Corporation', device_name: 'CoffeeLake-S GT2 [UHD Graphics 630]', iommugroup: 2, subsystem_vendor: '0x1043', subsystem_device: '0x8694', mdev: 1 },
    { id: '0000:01:00.0', class: '0x030000', vendor: '0x10de', device: '0x1eb8', vendor_name: 'NVIDIA Corporation', device_name: 'TU104GL [Tesla T4]', iommugroup: 12, subsystem_vendor: '0x10de', subsystem_device: '0x12a2', mdev: 1 },
    { id: '0000:01:00.1', class: '0x040300', vendor: '0x10de', device: '0x10f8', vendor_name: 'NVIDIA Corporation', device_name: 'TU104 HD Audio Controller', iommugroup: 12, subsystem_vendor: '0x10de', subsystem_device: '0x12a2' },
    { id: '0000:02:00.0', class: '0x030000', vendor: '0x10de', device: '0x1eb8', vendor_name: 'NVIDIA Corporation', device_name: 'TU104GL [Tesla T4]', iommugroup: 13, subsystem_vendor: '0x10de', subsystem_device: '0x12a2', mdev: 1 },
    { id: '0000:03:00.0', class: '0x020000', vendor: '0x8086', device: '0x1533', vendor_name: 'Intel Corporation', device_name: 'I210 Gigabit Network Connection', iommugroup: 14, subsystem_vendor: '0x8086', subsystem_device: '0x0001' },
    { id: '0000:04:00.0', class: '0x010802', vendor: '0x144d', device: '0xa808', vendor_name: 'Samsung Electronics Co Ltd', device_name: 'NVMe SSD Controller SM981/PM981/PM983', iommugroup: 14, subsystem_vendor: '0x144d', subsystem_device: '0xa801' },
  ]
}

export function mockUsbDevices() {
  return [
    { busnum: 1, devnum: 1, port: 0, level: 0, class: 9, vendid: '1d6b', prodid: '0002', product: 'EHCI Host Controller' },
    { busnum: 1, devnum: 3, port: 2, level: 1, class: 0, vendid: '046d', prodid: 'c52b', usbpath: '2', manufacturer: 'Logitech', product: 'USB Receiver', speed: '12' },
    { busnum: 1, devnum: 4, port: 3, level: 2, class: 0, vendid: '0951', prodid: '1666', usbpath: '3.1', manufacturer: 'Kingston', product: 'DataTraveler 3.0', speed: '5000' },
  ]
}

export function mockMappings(node: string) {
  return {
    pci: [
      {
        id: 'e2e-rm-t4',
        description: '两块 Tesla T4，自动选空闲的',
        mdev: 1,
        map: [
          `node=${node},path=0000:01:00.0,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=12`,
          `node=${node},path=0000:02:00.0,id=10de:1eb8,subsystem-id=10de:12a2,iommugroup=13`,
          'node=pve-gone,path=0000:01:00.0,id=10de:1eb8,iommugroup=7',
        ],
        digest: 'mock',
      },
      { id: 'e2e-rm-nic', 'live-migration-capable': 1, map: [`node=${node},path=0000:03:00.0,id=8086:1533,subsystem-id=8086:0001,iommugroup=9`], digest: 'mock' },
    ],
    usb: [
      { id: 'e2e-rm-dongle', description: 'Logitech 接收器', map: [`node=${node},id=046d:c52b`], digest: 'mock' },
      { id: 'e2e-rm-port', map: [`node=${node},path=1-4,id=0951:1666`], digest: 'mock' },
    ],
    dir: [
      { id: 'e2e-rm-share', description: '媒体库', map: [`node=${node},path=/mnt/media`], digest: 'mock' },
      { id: 'e2e-rm-missing', map: [`node=${node},path=/srv/missing`], digest: 'mock' },
    ],
  }
}

export function mockCpuModels() {
  return [
    { cputype: 'custom-e2e-rm-win', 'reported-model': 'Skylake-Server', hidden: 1, 'hv-vendor-id': 'proxmox', flags: '+aes;+pdpe1gb;-hypervisor', 'phys-bits': '40', digest: 'mock' },
    { cputype: 'custom-e2e-rm-epyc', 'reported-model': 'EPYC-Rome', level: 30, 'guest-phys-bits': 48, digest: 'mock' },
  ]
}

/** Mock every mapping read (lists, host hardware, dir checks, CPU models) for `node`. */
export async function mockMappingApi(page: Page, node: string) {
  const maps = mockMappings(node)
  await page.route(/\/api2\/json\/cluster\/mapping\/(pci|usb|dir)(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const kind = url.pathname.split('/').pop() as 'pci' | 'usb' | 'dir'
    const list = maps[kind].map((m) => ({ ...m }))
    if (kind === 'dir' && url.searchParams.get('check-node')) {
      for (const m of list) {
        ;(m as { checks?: unknown[] }).checks =
          m.id === 'e2e-rm-missing' ? [{ severity: 'error', message: 'Invalid configuration: Path /srv/missing does not exist\n' }] : []
      }
    }
    return route.fulfill({ json: { data: list } })
  })
  await page.route(/\/api2\/json\/nodes\/[^/]+\/hardware\/pci(\?.*)?$/, (route) => route.fulfill({ json: { data: mockPciDevices() } }))
  await page.route(/\/api2\/json\/nodes\/[^/]+\/hardware\/usb(\?.*)?$/, (route) => route.fulfill({ json: { data: mockUsbDevices() } }))
  await page.route(/\/api2\/json\/cluster\/qemu\/custom-cpu-models(\?.*)?$/, (route) => route.fulfill({ json: { data: mockCpuModels() } }))
}
