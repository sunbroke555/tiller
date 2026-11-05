// State machine for the journal viewer (node system log and per-service log),
// modelled on Proxmox.panel.JournalView:
//
// - live: load the last N entries, then poll with startcursor = last cursor
//   for new ones; "加载更早" asks for N entries before the first cursor.
// - range: load everything between two days, no polling.
//
// Filters (priority / identifier / unit / kernel) are server side and need the
// structured journal API (pve-manager ≥ 9.2.4, see PVE_FEATURES.journalFilters).
// The node's version decides the format before the first request; when it
// cannot be read in time the structured format is tried and a 400 falls back.
// On older PVE the plain format is used; a per-service log then falls back to
// GET /syslog?service=.

import { useCallback, useEffect, useRef, useState } from 'react'

import {
  fetchJournal,
  fetchServiceSyslog,
  journalStructuredHint,
  type JournalChunk,
  type JournalFilters,
  type JournalLine,
} from '@/api/node-summary'
import type { FeatureSupport } from '@/api/pve-features'

export const JOURNAL_PAGE = 500
/** Keep at most this many lines in memory / the DOM. */
export const JOURNAL_MAX_LINES = 5000
export const JOURNAL_POLL_MS = 2_000
/** How long the first request waits for the version check before probing. */
export const JOURNAL_SUPPORT_WAIT_MS = 2_500

export type JournalMode = 'live' | 'range'

export interface JournalRange {
  /** YYYY-MM-DD, local days, inclusive. */
  since: string
  until: string
}

export interface JournalState {
  lines: JournalLine[]
  host?: string
  /** undefined until the first answer. */
  structured?: boolean
  /** Service log on old PVE: lines come from /syslog?service= (no cursors). */
  syslogFallback: boolean
  identifiers: string[]
  units: string[]
  loading: boolean
  loadingOlder: boolean
  /** No more older entries (the last "older" request returned none). */
  atStart: boolean
  error: unknown
  /** Lines were dropped from the top to stay under JOURNAL_MAX_LINES. */
  truncated: boolean
}

const INITIAL: JournalState = {
  lines: [],
  syslogFallback: false,
  identifiers: [],
  units: [],
  loading: true,
  loadingOlder: false,
  atStart: false,
  error: null,
  truncated: false,
}

/** Local-day range → unix seconds [since 00:00, until+1 day 00:00). */
export function rangeToEpoch(range: JournalRange): { since: number; until: number } | null {
  const parse = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
  }
  const a = parse(range.since)
  const b = parse(range.until)
  if (!a || !b) return null
  b.setDate(b.getDate() + 1)
  if (b <= a) return null
  return { since: Math.floor(a.getTime() / 1000), until: Math.floor(b.getTime() / 1000) }
}

export function dayString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Append (or prepend) lines, keeping at most `max` (dropping from the far end). */
export function mergeLines(
  current: readonly JournalLine[],
  incoming: readonly JournalLine[],
  where: 'append' | 'prepend',
  max = JOURNAL_MAX_LINES,
): { lines: JournalLine[]; dropped: boolean } {
  if (incoming.length === 0) return { lines: current as JournalLine[], dropped: false }
  const all = where === 'append' ? [...current, ...incoming] : [...incoming, ...current]
  if (all.length <= max) return { lines: all, dropped: false }
  return where === 'append' ? { lines: all.slice(all.length - max), dropped: true } : { lines: all.slice(0, max), dropped: false }
}

export interface UseJournalOptions {
  node: string
  mode: JournalMode
  range: JournalRange
  filters: JournalFilters
  /** Live polling on/off (paused by the user or scrolled away). */
  follow: boolean
  /** Bump to reload from scratch (retry button). */
  reloadKey?: number
  /** usePveFeature('journalFilters', node). */
  support?: FeatureSupport
}

/**
 * The request format, fixed once per node: the version check's answer, or
 * "probe" (undefined) when it is still unknown after JOURNAL_SUPPORT_WAIT_MS.
 * null while waiting. Later version answers don't reload what already shows.
 */
function useStructuredHint(node: string, support: FeatureSupport): { value: boolean | undefined } | null {
  const [decided, setDecided] = useState<{ node: string; value: boolean | undefined } | null>(null)
  const current = decided?.node === node ? decided : null
  useEffect(() => {
    if (current) return
    if (support !== 'unknown') {
      setDecided({ node, value: journalStructuredHint(support) })
      return
    }
    const t = setTimeout(() => setDecided({ node, value: undefined }), JOURNAL_SUPPORT_WAIT_MS)
    return () => clearTimeout(t)
  }, [node, support, current])
  if (current) return current
  // Known on the first render: no need to wait for the effect.
  return support === 'unknown' ? null : { value: journalStructuredHint(support) }
}

export function useJournal({ node, mode, range, filters, follow, reloadKey = 0, support = 'unknown' }: UseJournalOptions) {
  const [state, setState] = useState<JournalState>(INITIAL)
  const cursors = useRef<{ first?: string; last?: string }>({})
  const listsLoaded = useRef(false)
  const generation = useRef(0)
  const hint = useStructuredHint(node, support)
  const ready = hint !== null
  const structured = hint?.value

  const filterKey = JSON.stringify(filters)

  // Initial load (and on mode / range / filter change).
  useEffect(() => {
    if (!ready) return
    const gen = ++generation.current
    const ctrl = new AbortController()
    cursors.current = {}
    setState((s) => ({ ...INITIAL, identifiers: s.identifiers, units: s.units, structured: s.structured }))

    const apply = (chunk: JournalChunk) => {
      if (gen !== generation.current) return
      cursors.current = { first: chunk.firstCursor, last: chunk.lastCursor }
      if (chunk.identifiers || chunk.units) listsLoaded.current = true
      const { lines, dropped } = mergeLines([], chunk.lines, 'append')
      setState((s) => ({
        ...s,
        lines,
        host: chunk.host ?? s.host,
        structured: chunk.structured,
        identifiers: chunk.identifiers ? [...chunk.identifiers].sort((a, b) => a.localeCompare(b)) : s.identifiers,
        units: chunk.units ? [...chunk.units].sort((a, b) => a.localeCompare(b)) : s.units,
        loading: false,
        error: null,
        truncated: dropped,
        atStart: mode === 'range',
      }))
    }

    const load = async () => {
      try {
        if (mode === 'range') {
          const epoch = rangeToEpoch(range)
          if (!epoch) {
            setState((s) => ({ ...s, loading: false, lines: [], error: new Error('时间范围无效') }))
            return
          }
          apply(
            await fetchJournal(node, { mode: 'range', ...epoch }, filters, {
              withLists: !listsLoaded.current,
              signal: ctrl.signal,
              structured,
            }),
          )
        } else {
          const chunk = await fetchJournal(node, { mode: 'tail', lastentries: JOURNAL_PAGE }, filters, {
            withLists: !listsLoaded.current,
            signal: ctrl.signal,
            structured,
          })
          if (!chunk.structured && filters.unit) {
            // Old PVE: the journal cannot filter by unit; read the service's syslog instead.
            const lines = await fetchServiceSyslog(node, filters.unit, JOURNAL_PAGE, ctrl.signal)
            if (gen !== generation.current) return
            setState((s) => ({ ...s, lines, structured: false, syslogFallback: true, loading: false, error: null, atStart: true }))
            return
          }
          apply(chunk)
        }
      } catch (e) {
        if (ctrl.signal.aborted || gen !== generation.current) return
        setState((s) => ({ ...s, loading: false, error: e }))
      }
    }
    void load()
    return () => ctrl.abort()
    // filters are compared through filterKey
  }, [node, mode, range.since, range.until, filterKey, reloadKey, ready, structured])

  // Live polling for new entries.
  useEffect(() => {
    if (mode !== 'live' || !follow || state.loading || state.error) return
    const gen = generation.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const ctrl = new AbortController()

    const tick = async () => {
      if (stopped) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        timer = setTimeout(tick, JOURNAL_POLL_MS)
        return
      }
      try {
        if (state.syslogFallback && filters.unit) {
          const lines = await fetchServiceSyslog(node, filters.unit, JOURNAL_PAGE, ctrl.signal)
          if (gen === generation.current && !stopped) setState((s) => ({ ...s, lines }))
        } else if (cursors.current.last) {
          const chunk = await fetchJournal(node, { mode: 'follow', startcursor: cursors.current.last }, filters, {
            signal: ctrl.signal,
            structured,
          })
          if (gen !== generation.current || stopped) return
          // Only move the cursor when the answer carried one (an empty poll must not lose our place).
          if (chunk.lastCursor) cursors.current.last = chunk.lastCursor
          if (!cursors.current.first && chunk.firstCursor) cursors.current.first = chunk.firstCursor
          if (chunk.lines.length) {
            setState((s) => {
              const { lines, dropped } = mergeLines(s.lines, chunk.lines, 'append')
              return { ...s, lines, truncated: s.truncated || dropped, host: chunk.host ?? s.host }
            })
          }
        }
      } catch {
        // transient: try again on the next tick
      }
      if (!stopped) timer = setTimeout(tick, JOURNAL_POLL_MS)
    }
    timer = setTimeout(tick, JOURNAL_POLL_MS)
    return () => {
      stopped = true
      ctrl.abort()
      if (timer) clearTimeout(timer)
    }
  }, [node, mode, follow, state.loading, state.error, state.syslogFallback, filterKey, structured])

  const loadOlder = useCallback(async () => {
    const first = cursors.current.first
    if (!first || mode !== 'live') return
    const gen = generation.current
    setState((s) => ({ ...s, loadingOlder: true }))
    try {
      const chunk = await fetchJournal(node, { mode: 'older', endcursor: first, lastentries: JOURNAL_PAGE }, filters, { structured })
      if (gen !== generation.current) return
      if (chunk.firstCursor) cursors.current.first = chunk.firstCursor
      setState((s) => {
        const { lines } = mergeLines(s.lines, chunk.lines, 'prepend')
        return { ...s, lines, loadingOlder: false, atStart: chunk.lines.length === 0 }
      })
    } catch (e) {
      if (gen !== generation.current) return
      setState((s) => ({ ...s, loadingOlder: false, error: s.lines.length ? s.error : e }))
      throw e
    }
  }, [node, mode, filterKey, structured])

  return { ...state, loadOlder }
}
