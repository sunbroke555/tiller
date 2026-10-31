import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import type { GuestTabProps } from '@/features/guest/types'

/** Placeholder owned by area `qemu-config`: replace with the real tab. */
export default function CloudInitTab(_props: GuestTabProps) {
  return <AreaPlaceholder area="qemu-config">Cloud-Init 用户、密码、SSH 公钥、DNS 和 IP 配置。</AreaPlaceholder>
}
