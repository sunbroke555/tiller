// Paths of the SDN section (/datacenter/sdn/<section>/<item>).

export const SDN_BASE = '/datacenter/sdn'

export const SECTIONS = [
  { id: '', label: '概览' },
  { id: 'zones', label: 'Zone' },
  { id: 'vnets', label: 'VNet' },
  { id: 'options', label: '选项' },
  { id: 'ipam', label: 'IPAM' },
  { id: 'fabrics', label: 'Fabrics' },
  { id: 'route-maps', label: 'Route Map' },
  { id: 'prefix-lists', label: '前缀列表' },
] as const

export type SdnSection = (typeof SECTIONS)[number]['id']

export function sdnHref(section: SdnSection, item?: string): string {
  return section ? `${SDN_BASE}/${section}${item ? `/${encodeURIComponent(item)}` : ''}` : SDN_BASE
}
