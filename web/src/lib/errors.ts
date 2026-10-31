import { isPveApiError } from '@/api/client'

/** A short, user-facing message for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isPveApiError(e)) return e.detail
  if (e instanceof Error && e.message) return e.message
  if (typeof e === 'string' && e) return e
  return '发生未知错误'
}
