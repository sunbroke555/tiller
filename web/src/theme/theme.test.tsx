import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyThemeAttributes, loadPrefs, savePrefs } from './apply'
import { themeBootScript } from './boot'
import { DEFAULT_PREFS, THEME_STORAGE_KEY, parsePrefs, themeAttributes, type AppearancePrefs } from './prefs'
import { ThemeProvider, useTheme } from './ThemeProvider'

function mockColorScheme(dark: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches: dark,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.add(l),
    removeEventListener: (_: string, l: (e: MediaQueryListEvent) => void) => listeners.delete(l),
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql),
  )
  return {
    set(next: boolean) {
      mql.matches = next
      for (const l of listeners) l({ matches: next } as MediaQueryListEvent)
    },
  }
}

function resetRoot() {
  const root = document.documentElement
  for (const a of ['data-theme', 'data-accent', 'data-glass', 'data-density', 'class', 'style']) root.removeAttribute(a)
  document.head.innerHTML =
    '<meta name="theme-color" content=""><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
}

function rootState() {
  const root = document.documentElement
  return {
    theme: root.getAttribute('data-theme'),
    accent: root.getAttribute('data-accent'),
    glass: root.getAttribute('data-glass'),
    density: root.getAttribute('data-density'),
    dark: root.classList.contains('dark'),
    scheme: root.style.colorScheme,
    meta: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
    statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.getAttribute('content'),
  }
}

beforeEach(resetRoot)
afterEach(() => vi.unstubAllGlobals())

describe('preferences', () => {
  it('defaults when nothing or garbage is stored', () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('{not json')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('42')).toEqual(DEFAULT_PREFS)
    expect(parsePrefs('null')).toEqual(DEFAULT_PREFS)
  })

  it('keeps valid fields and replaces invalid ones', () => {
    expect(parsePrefs(JSON.stringify({ mode: 'paper', accent: 'purple', glass: 'yes', density: 'compact' }))).toEqual({
      mode: 'paper',
      accent: 'indigo',
      glass: true,
      density: 'compact',
    })
  })

  it('persists to localStorage and reads back', () => {
    const prefs: AppearancePrefs = { mode: 'light', accent: 'teal', glass: false, density: 'compact' }
    savePrefs(prefs)
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toEqual(prefs)
    expect(loadPrefs()).toEqual(prefs)
  })

  it('survives storage that throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadPrefs()).toEqual(DEFAULT_PREFS)
    spy.mockRestore()
  })

  it('resolves system and forces paper to clay without glass', () => {
    expect(themeAttributes({ ...DEFAULT_PREFS, mode: 'system' }, true)).toMatchObject({ theme: 'dark', dark: true })
    expect(themeAttributes({ ...DEFAULT_PREFS, mode: 'system' }, false)).toMatchObject({ theme: 'light', dark: false })
    expect(themeAttributes({ mode: 'paper', accent: 'rose', glass: true, density: 'compact' }, true)).toEqual({
      theme: 'paper',
      accent: 'clay',
      glass: 'off',
      density: 'compact',
      dark: false,
      themeColor: '#faf9f5',
    })
    expect(themeAttributes({ mode: 'dark', accent: 'rose', glass: false, density: 'comfortable' }, false)).toMatchObject({
      accent: 'rose',
      glass: 'off',
    })
  })
})

describe('iOS status bar style', () => {
  it('uses dark text on the light themes and the translucent bar on dark', () => {
    applyThemeAttributes(themeAttributes(parsePrefs(JSON.stringify({ mode: 'paper' })), false))
    expect(rootState().statusBar).toBe('default')
    applyThemeAttributes(themeAttributes(parsePrefs(JSON.stringify({ mode: 'dark' })), false))
    expect(rootState().statusBar).toBe('black-translucent')
  })
})

describe('boot script parity', () => {
  const stored: (string | null)[] = [
    null,
    'garbage',
    JSON.stringify({ mode: 'dark', accent: 'teal', glass: false, density: 'compact' }),
    JSON.stringify({ mode: 'light', accent: 'orange' }),
    JSON.stringify({ mode: 'paper', accent: 'rose', glass: true }),
    JSON.stringify({ mode: 'system', accent: 'nope', density: 'tiny' }),
    JSON.stringify(['array']),
  ]

  for (const raw of stored) {
    for (const prefersDark of [true, false]) {
      it(`matches applyThemeAttributes for ${raw} (dark=${prefersDark})`, () => {
        mockColorScheme(prefersDark)
        if (raw !== null) localStorage.setItem(THEME_STORAGE_KEY, raw)

        new Function(themeBootScript)()
        const fromBoot = rootState()

        resetRoot()
        applyThemeAttributes(themeAttributes(parsePrefs(raw), prefersDark))
        expect(rootState()).toEqual(fromBoot)
      })
    }
  }

  it('never throws, even without storage or matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => new Function(themeBootScript)()).not.toThrow()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})

function Probe() {
  const { prefs, resolved, setPrefs } = useTheme()
  return (
    <div>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPrefs({ mode: 'paper' })}>paper</button>
      <button onClick={() => setPrefs({ accent: 'rose', density: 'compact' })}>rose</button>
      <span data-testid="accent">{prefs.accent}</span>
    </div>
  )
}

describe('ThemeProvider', () => {
  it('applies, persists and follows the system scheme', () => {
    const scheme = mockColorScheme(true)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('resolved').textContent).toBe('dark')
    expect(rootState()).toMatchObject({ theme: 'dark', accent: 'indigo', dark: true, meta: '#07080a' })

    act(() => scheme.set(false))
    expect(rootState()).toMatchObject({ theme: 'light', dark: false })

    act(() => screen.getByText('rose').click())
    expect(rootState()).toMatchObject({ accent: 'rose', density: 'compact' })
    expect(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)!)).toMatchObject({ accent: 'rose', density: 'compact' })

    act(() => screen.getByText('paper').click())
    expect(rootState()).toMatchObject({ theme: 'paper', accent: 'clay', glass: 'off', meta: '#faf9f5' })
    expect(loadPrefs().mode).toBe('paper')
  })

  it('picks up changes from another tab', () => {
    mockColorScheme(false)
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    )
    const next = JSON.stringify({ mode: 'dark', accent: 'teal', glass: true, density: 'comfortable' })
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: next }))
    })
    expect(screen.getByTestId('accent').textContent).toBe('teal')
    expect(rootState()).toMatchObject({ theme: 'dark', accent: 'teal' })
  })
})
