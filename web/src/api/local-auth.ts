import { clearSession, getSession, setSession, type Session } from './session'

export interface AuthState { setupRequired: boolean; session: Session | null }
export const authKey = ['tiller-auth'] as const

export async function localAuthRequest<T>(path: string, input?: unknown): Promise<T> {
  const res = await fetch('/api/auth/' + path, {
    method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', CSRFPreventionToken: getSession()?.csrfToken ?? '' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json() as T & { message?: string }
  if (!res.ok) throw new Error(data.message || `请求失败（HTTP ${res.status}）`)
  return data
}

export async function fetchLocalSession(): Promise<AuthState> {
  const state = await localAuthRequest<AuthState>('session')
  if (state.session) setSession(state.session)
  else clearSession('expired')
  return state
}

export async function loginLocal(username: string, password: string, setup: boolean): Promise<AuthState> {
  const state = await localAuthRequest<AuthState>(setup ? 'setup' : 'login', { username, password })
  if (state.session) setSession(state.session)
  return state
}

export async function logoutLocal(): Promise<void> {
  await localAuthRequest('logout', {})
  clearSession()
  window.location.assign('/login')
}

export async function changeLocalPassword(currentPassword: string, password: string): Promise<void> {
  await localAuthRequest('password', { currentPassword, password })
  clearSession()
  window.location.assign('/login')
}
