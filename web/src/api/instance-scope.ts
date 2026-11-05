// The URL fixes the instance for the lifetime of this document. Switching
// loads a new document, dropping old queries, mutations and console clients.
// Tabs can therefore manage different PVEs without sharing an active target.
export interface InstanceScope {
  id: string
  version: string
}

export function scopeFromPath(path: string): InstanceScope | null {
  const match = /^\/i\/([a-f0-9]{24})\/([a-f0-9]{24})(?:\/|$)/.exec(path)
  return match ? { id: match[1]!, version: match[2]! } : null
}

const scope = typeof window === 'undefined' ? null : scopeFromPath(window.location.pathname)

export function getInstanceScope(): InstanceScope | null {
  return scope
}

export function instanceBase(s: InstanceScope | null = scope): string {
  return s ? `/i/${s.id}/${s.version}` : ''
}

export function instanceApiBase(selected: InstanceScope | null = scope): string {
  return selected ? `/api/instances/${selected.id}/${selected.version}` : ''
}

export function instanceStorageKey(key: string): string {
  return scope ? `${key}:${scope.id}:${scope.version}` : key
}

export function instanceAppUrl(path: string): string {
  return instanceBase() + path
}
