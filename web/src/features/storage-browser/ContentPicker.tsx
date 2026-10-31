import type { StorageContent } from '@/api/types'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { STORAGE_CONTENT_LABEL } from '@/features/storage/types'

import { CONTENT_ICON } from './labels'

/** Segmented choice of a content type (upload / download target). */
export function ContentPicker({
  value,
  options,
  onChange,
  disabled,
}: {
  value: StorageContent
  options: readonly StorageContent[]
  onChange: (value: StorageContent) => void
  disabled?: boolean
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(v) => v && onChange(v as StorageContent)}
      disabled={disabled}
      aria-label="内容类型"
      className="w-full"
    >
      {options.map((c) => {
        const Icon = CONTENT_ICON[c]
        return (
          <ToggleGroupItem key={c} value={c} className="h-10 flex-1 gap-1.5 px-2 text-xs sm:text-sm pointer-coarse:h-11">
            <Icon aria-hidden />
            {STORAGE_CONTENT_LABEL[c]}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}
