import { useState } from 'react'
import { ScrollText } from 'lucide-react'

import { useAppConfig } from '@/api/shell'
import { Markdown } from '@/components/Markdown'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { Button } from '@/components/ui/button'

const ACCEPTED_KEY = 'pve-web:consent-accepted'

/** Cheap stable fingerprint of the text, so a changed consent text is shown again. */
export function consentFingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return `${text.length}:${(h >>> 0).toString(36)}`
}

function accepted(text: string): boolean {
  try {
    return sessionStorage.getItem(ACCEPTED_KEY) === consentFingerprint(text)
  } catch {
    return false
  }
}

/**
 * The datacenter "consent text" (Datacenter → Options), shown before login
 * like the official UI. The pve-web server reads it from PVE's login page
 * (GET /api/config), since the API needs a ticket for /cluster/options.
 * Accepting is remembered for this browser tab session only.
 */
export function ConsentGate() {
  const { data } = useAppConfig()
  const text = data?.consentText?.trim() ?? ''
  const [ok, setOk] = useState(false)
  if (!text || ok || accepted(text)) return null

  const accept = () => {
    try {
      sessionStorage.setItem(ACCEPTED_KEY, consentFingerprint(text))
    } catch {
      // ignore
    }
    setOk(true)
  }

  return (
    <ResponsiveDialog
      open
      onOpenChange={() => {}}
      dismissible={false}
      title={
        <span className="inline-flex items-center gap-2">
          <ScrollText className="size-5 text-brand" aria-hidden /> 使用须知
        </span>
      }
      description="登录前请阅读并同意以下内容"
      size="lg"
      footer={
        <Button size="lg" className="w-full sm:w-auto" onClick={accept}>
          我已阅读并同意
        </Button>
      }
    >
      <Markdown source={text} />
    </ResponsiveDialog>
  )
}
