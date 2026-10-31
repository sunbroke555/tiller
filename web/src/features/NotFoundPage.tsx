import { Link } from 'react-router'
import { MapPinOff } from 'lucide-react'

import { EmptyState } from '@/components/EmptyState'
import { GlassCard } from '@/components/GlassCard'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <GlassCard className="mt-8">
      <EmptyState
        icon={MapPinOff}
        title="页面不存在"
        description="链接可能已失效，或者这个功能还没有实现。"
        action={
          <Button asChild variant="outline">
            <Link to="/">回到概览</Link>
          </Button>
        }
      />
    </GlassCard>
  )
}
