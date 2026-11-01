import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, RefreshCw } from 'lucide-react'

import { checkVmidFree, fetchNextId } from '@/api/queries'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

import { NumberInput } from './NumberInput'

export const VMID_MIN = 100
export const VMID_MAX = 999_999_999

export type VmidValidity = 'checking' | 'free' | 'taken' | 'invalid' | 'unknown'

export interface VmidInputProps {
  value: number | undefined
  onChange: (vmid: number | undefined) => void
  /** Fill in GET /cluster/nextid when empty (default true). */
  autoFill?: boolean
  /** Called whenever the availability check changes; submit only on 'free'. */
  onValidityChange?: (validity: VmidValidity) => void
  disabled?: boolean
  className?: string
}

/**
 * VMID field: suggests the next free id, checks availability as the user
 * types (debounced GET /cluster/nextid?vmid=…) and shows the result below.
 */
export function VmidInput({ value, onChange, autoFill = true, onValidityChange, disabled, className }: VmidInputProps) {
  const [validity, setValidity] = useState<VmidValidity>('unknown')
  const [message, setMessage] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const latest = useRef(value)
  latest.current = value

  /** `onlyIfEmpty`: the automatic suggestion must not replace an id typed meanwhile. */
  const fill = async (onlyIfEmpty = false) => {
    setFilling(true)
    try {
      const next = await fetchNextId()
      if (Number.isFinite(next) && !(onlyIfEmpty && latest.current !== undefined)) onChange(next)
    } catch (e) {
      setMessage(errorMessage(e))
      setValidity('unknown')
    } finally {
      setFilling(false)
    }
  }

  useEffect(() => {
    if (autoFill && value === undefined) void fill(true)
    // Only on mount: clearing the field later must not refill it.
  }, [])

  useEffect(() => {
    if (value === undefined) {
      setValidity('unknown')
      setMessage(null)
      return
    }
    if (!Number.isInteger(value) || value < VMID_MIN || value > VMID_MAX) {
      setValidity('invalid')
      setMessage(`ID 需在 ${VMID_MIN} 到 ${VMID_MAX} 之间`)
      return
    }
    setValidity('checking')
    setMessage(null)
    const ac = new AbortController()
    const t = setTimeout(() => {
      checkVmidFree(value, ac.signal)
        .then((err) => {
          setValidity(err ? 'taken' : 'free')
          setMessage(err ? `ID ${value} 已被使用` : null)
        })
        .catch((e: unknown) => {
          if (ac.signal.aborted) return
          setValidity('unknown')
          setMessage(errorMessage(e))
        })
    }, 350)
    return () => {
      ac.abort()
      clearTimeout(t)
    }
  }, [value])

  useEffect(() => {
    onValidityChange?.(validity)
  }, [validity, onValidityChange])

  return (
    <div className={cn('grid gap-1.5', className)}>
      <div className="flex items-center gap-2">
        <NumberInput
          value={value}
          onChange={onChange}
          min={VMID_MIN}
          max={VMID_MAX}
          disabled={disabled}
          placeholder={filling ? '获取中…' : '例如 100'}
          aria-invalid={validity === 'taken' || validity === 'invalid' ? true : undefined}
          className="flex-1"
        />
        <button
          type="button"
          onClick={() => void fill()}
          disabled={disabled || filling}
          aria-label="使用下一个可用 ID"
          title="使用下一个可用 ID"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-input bg-(--field) text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 pointer-coarse:size-11"
        >
          <RefreshCw className={cn('size-4', filling && 'animate-spin')} />
        </button>
      </div>
      <p
        aria-live="polite"
        className={cn(
          'flex min-h-4 items-center gap-1.5 text-xs',
          validity === 'free' && 'text-success-strong',
          (validity === 'taken' || validity === 'invalid') && 'text-destructive',
          (validity === 'checking' || validity === 'unknown') && 'text-muted-foreground',
        )}
      >
        {validity === 'checking' && (
          <>
            <Loader2 className="size-3 animate-spin" aria-hidden /> 正在检查…
          </>
        )}
        {validity === 'free' && (
          <>
            <Check className="size-3" aria-hidden /> 可用
          </>
        )}
        {message}
      </p>
    </div>
  )
}
