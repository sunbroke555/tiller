import { useMemo } from 'react'

import { encodeQr, qrSvgPath } from '@/lib/qrcode'
import { cn } from '@/lib/utils'

/**
 * A QR code as SVG. Always dark modules on a white tile (scanners need the
 * contrast, whatever the theme).
 */
export function QrCode({ value, className, label = '二维码' }: { value: string; className?: string; label?: string }) {
  const { path, size } = useMemo(() => {
    const qr = encodeQr(value, 'M')
    return { path: qrSvgPath(qr, 4), size: qr.size + 8 }
  }, [value])
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={cn('rounded-xl bg-white p-0 ring-1 ring-black/10', className)}
    >
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  )
}
