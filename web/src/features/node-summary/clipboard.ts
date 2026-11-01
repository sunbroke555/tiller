import { toast } from 'sonner'

/**
 * Copy text. navigator.clipboard needs a secure context (https or localhost);
 * Tiller is often opened over plain http on the LAN, so fall back to a
 * hidden textarea + execCommand.
 */
export async function copyText(text: string, success = '已复制'): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      toast.success(success)
      return true
    }
  } catch {
    // fall through
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }
  ta.remove()
  if (ok) toast.success(success)
  else toast.error('复制失败，请手动选择文本复制')
  return ok
}

/** Save text as a file. */
export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** "20261101-0830" for file names. */
export function fileStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}
