import { Link, useParams } from 'react-router'
import { ChevronLeft } from 'lucide-react'

import { AmbientBackground } from '@/components/AmbientBackground'
import { AreaPlaceholder } from '@/components/page/AreaPlaceholder'
import { nodePath } from '@/lib/resources'

/**
 * Placeholder owned by area `console`: full-screen console outside the app
 * frame. Routes: /console/:node/:type/:vmid (VM/CT) and /console/:node/shell.
 */
export default function ConsolePage() {
  const { node = '', type, vmid } = useParams()
  const isShell = !type
  const back = isShell ? nodePath(node) : `/guest/${encodeURIComponent(node)}/${type}/${vmid}`
  return (
    <div className="relative min-h-dvh bg-background">
      <AmbientBackground />
      <div className="relative z-10 mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
        <Link
          to={back}
          className="-ml-2 inline-flex h-11 w-fit items-center gap-1 rounded-full px-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-5" /> 返回
        </Link>
        <AreaPlaceholder area="console">
          {isShell ? `节点 ${node} 的 Shell` : `${type === 'lxc' ? 'CT' : 'VM'} ${vmid} 的控制台`}（noVNC / xterm.js）。
        </AreaPlaceholder>
      </div>
    </div>
  )
}
