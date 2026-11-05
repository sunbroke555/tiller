import { createElement, lazy, type ComponentType } from 'react'

type Module<P> = { default: ComponentType<P> }
export type PreloadableComponent<P> = ComponentType<P> & { preload: () => Promise<Module<P>> }

/** Route loaders and link intent share the same import; importing never mounts the page. */
export function lazyComponent<P extends object>(load: () => Promise<Module<P>>): PreloadableComponent<P> {
  let loaded: ComponentType<P> | undefined
  let pending: Promise<Module<P>> | undefined
  const preload = () => pending ??= load().then((module) => {
    loaded = module.default
    return module
  }).catch((error: unknown) => {
    // A failed speculative load must not poison a later navigation attempt.
    pending = undefined
    throw error
  })
  const Lazy = lazy(preload)
  return Object.assign(function PreloadedComponent(props: P) {
    // A resolved native Promise still suspends on React.lazy's first render.
    // Use the resolved component directly so its queries can start immediately.
    return createElement(loaded ?? Lazy, props)
  }, { preload })
}

/** Navigation handles failures; a speculative import must not reject unhandled. */
export function preloadOnIntent(component: { preload?: () => Promise<unknown> }): void {
  void component.preload?.().catch(() => {})
}
