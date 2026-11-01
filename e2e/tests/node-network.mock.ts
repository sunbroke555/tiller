import type { Page } from '@playwright/test'

// Mocked GET /nodes/{node}/network for the phone checks and screenshots of
// node-network: a typical host with bridges, a bond, VLANs and pending changes.

export const MOCK_IFACES = [
  { iface: 'eno1', type: 'eth', active: 1, exists: 1, method: 'manual', families: ['inet'], altnames: ['enp3s0f0', 'enx3cecef0a1b2c'] },
  { iface: 'eno2', type: 'eth', active: 1, exists: 1, method: 'manual', families: ['inet'], altnames: ['enp3s0f1'] },
  { iface: 'enp5s0', type: 'eth', exists: 1, method: 'manual', families: ['inet'], mtu: '9000', comments: '存储网（未接线）\n' },
  {
    iface: 'bond0',
    type: 'bond',
    active: 1,
    autostart: 1,
    slaves: 'eno1 eno2',
    bond_mode: '802.3ad',
    bond_xmit_hash_policy: 'layer3+4',
    method: 'manual',
    families: ['inet'],
  },
  {
    iface: 'vmbr0',
    type: 'bridge',
    active: 1,
    autostart: 1,
    bridge_ports: 'bond0',
    bridge_vlan_aware: 1,
    bridge_vids: '2-4094',
    cidr: '192.168.10.5/24',
    address: '192.168.10.5',
    netmask: '24',
    gateway: '192.168.10.1',
    cidr6: '2001:db8:10::5/64',
    gateway6: '2001:db8:10::1',
    method: 'static',
    families: ['inet', 'inet6'],
    comments: '管理网（LACP）\n',
  },
  {
    iface: 'vmbr1',
    type: 'bridge',
    autostart: 1,
    bridge_ports: '',
    cidr: '10.10.0.1/24',
    method: 'static',
    families: ['inet'],
    comments: '内部网桥\n',
  },
  { iface: 'vmbr0.20', type: 'vlan', active: 1, autostart: 1, cidr: '10.20.0.5/24', method: 'static', families: ['inet'] },
]

export const MOCK_DIFF = `--- /etc/network/interfaces	2026-10-30 09:12:44.000000000 +0800
+++ /etc/network/interfaces.new	2026-11-01 15:02:10.000000000 +0800
@@ -20,14 +20,22 @@
 auto vmbr0
 iface vmbr0 inet static
 	address 192.168.10.5/24
 	gateway 192.168.10.1
 	bridge-ports bond0
 	bridge-vlan-aware yes
 	bridge-vids 2-4094
-#管理网
+#管理网（LACP）
 
+auto vmbr1
+iface vmbr1 inet static
+	address 10.10.0.1/24
+	bridge-ports none
+	bridge-stp off
+	bridge-fd 0
+#内部网桥
+
 auto vmbr0.20
 iface vmbr0.20 inet static
-	address 10.20.0.4/24
+	address 10.20.0.5/24
`

/** Serve the mocked interface list (with the pending diff) for `node`. */
export async function mockNetwork(page: Page, node: string, opts: { changes?: string } = {}) {
  const path = `/api2/json/nodes/${node}/network`
  await page.route(
    (url) => url.pathname === path,
    (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      const changes = opts.changes ?? MOCK_DIFF
      return route.fulfill({ json: changes ? { data: MOCK_IFACES, changes } : { data: MOCK_IFACES } })
    },
  )
}
