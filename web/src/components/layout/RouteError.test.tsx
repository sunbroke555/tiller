import { render, screen } from '@testing-library/react'
import { RouterProvider, createMemoryRouter, type RouteObject } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import { routes } from '@/routes'

import { RouteError } from './RouteError'

function Boom(): never {
  throw new Error('render exploded')
}

describe('RouteError', () => {
  it('asks to reload when a lazy chunk of an old build is gone', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter(
      [
        {
          path: '/tasks',
          errorElement: <RouteError />,
          lazy: () => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/TasksPage-abc.js')),
        },
      ],
      { initialEntries: ['/tasks'] },
    )
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('页面已更新')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeInTheDocument()
    expect(screen.queryByText(/Unexpected Application Error/)).not.toBeInTheDocument()
  })

  it('shows render errors in the app style with a way home', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const router = createMemoryRouter([{ path: '/', element: <Boom />, errorElement: <RouteError fullScreen /> }])
    render(<RouterProvider router={router} />)
    expect(await screen.findByText('这部分界面出错了')).toBeInTheDocument()
    expect(screen.getByText('render exploded')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '回到概览' })).toHaveAttribute('href', '/')
  })

  it('covers every route of the app', () => {
    // Each top-level route handles its own errors; pages inside the frame
    // get a nested boundary so the frame keeps working.
    for (const route of routes) expect(route.errorElement, route.path ?? 'layout').toBeTruthy()
    const shell = routes.find((r) => r.children?.some((c) => c.errorElement && c.children?.some((p) => p.index)))
    expect(shell).toBeDefined()
    const pages = (shell!.children![0] as RouteObject).children!
    expect(pages.some((p) => p.path === 'tasks')).toBe(true)
  })
})
