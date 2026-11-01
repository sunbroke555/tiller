// Node updates area (node-updates): pending package updates, apt refresh,
// changelogs and the APT repository configuration.
//
//   GET  /nodes/{node}/apt/update          pending updates (cached by pve-daily-update / refresh)
//   POST /nodes/{node}/apt/update          apt-get update → UPID
//   GET  /nodes/{node}/apt/changelog       name, version → plain text
//   GET  /nodes/{node}/apt/versions        Proxmox related packages (see api/node-summary.ts)
//   GET  /nodes/{node}/apt/repositories    files, errors, infos, standard-repos, digest
//   POST /nodes/{node}/apt/repositories    path, index, enabled, digest → enable / disable one repository
//   PUT  /nodes/{node}/apt/repositories    handle, digest → add (or enable) a standard repository
//
// The upgrade itself has no REST call: the official UI opens a node shell
// running `pveupgrade` (termproxy cmd=upgrade, root@pam only); see
// features/node-updates/paths.ts. Shapes follow proxmoxlib.js
// (Proxmox.node.APT, Proxmox.node.APTRepositories) and the lab's answers.

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'

import { get, p, post, put } from './client'
import type { AptStandardRepo } from './node-summary'
import { queryKeys } from './queries'
import type { PveBool } from './types'

export type { AptStandardRepo }

type QueryOpts<TData> = Omit<UseQueryOptions<TData, Error, TData>, 'queryKey' | 'queryFn'>

// ------------------------------------------------------------------ types

/** One entry of GET /nodes/{node}/apt/update. */
export interface AptUpdate {
  Package: string
  /** Short description. */
  Title?: string
  /** Long description. */
  Description?: string
  /** Candidate (new) version. */
  Version: string
  /** Installed version. */
  OldVersion?: string
  /** "Proxmox", "Debian", … */
  Origin?: string
  Arch?: string
  Priority?: string
  Section?: string
}

export interface AptRepoOption {
  Key: string
  Values: string[]
}

export type AptFileType = 'list' | 'sources'

/** One repository (a line of a .list file or a stanza of a .sources file). */
export interface AptRepository {
  Types: string[]
  URIs: string[]
  Suites: string[]
  Components?: string[]
  Options?: AptRepoOption[]
  Comment?: string
  FileType: AptFileType
  Enabled: PveBool | boolean
}

export interface AptRepoFile {
  path: string
  'file-type': AptFileType
  repositories: AptRepository[]
  /** SHA-256 of the file as a byte array. */
  digest?: number[]
}

/** Extra information about one repository (origin, warnings). */
export interface AptRepoInfo {
  path: string
  index: number
  /** "origin" | "warning" | "ignore-pre-upgrade-warning" | … */
  kind: string
  message: string
  /** The repository property a warning is about, e.g. "Suites". */
  property?: string
}

export interface AptRepoFileError {
  path: string
  error: string
}

/** GET /nodes/{node}/apt/repositories */
export interface AptRepositories {
  files: AptRepoFile[]
  errors: AptRepoFileError[]
  infos: AptRepoInfo[]
  'standard-repos': AptStandardRepo[]
  /** Digest of all files together, sent back with changes. */
  digest: string
}

// ------------------------------------------------------------- query keys

export const updateKeys = {
  updates: (node: string) => [...queryKeys.node(node), 'apt', 'update'] as const,
  changelog: (node: string, name: string, version: string) => [...queryKeys.node(node), 'apt', 'changelog', name, version] as const,
  /** Same key as nodeKeys.repositories (node summary), so both share the cache. */
  repositories: (node: string) => [...queryKeys.node(node), 'apt', 'repositories'] as const,
}

// ------------------------------------------------------------------ hooks

export function useAptUpdates(node: string, options?: QueryOpts<AptUpdate[]>) {
  return useQuery({
    queryKey: updateKeys.updates(node),
    queryFn: ({ signal }) => get<AptUpdate[]>(p`/nodes/${node}/apt/update`, undefined, { signal }),
    staleTime: 60_000,
    retry: 1,
    ...options,
  })
}

export function useAptChangelog(node: string, name: string, version: string, options?: QueryOpts<string>) {
  return useQuery({
    queryKey: updateKeys.changelog(node, name, version),
    queryFn: ({ signal }) => get<string>(p`/nodes/${node}/apt/changelog`, { name, version: version || undefined }, { signal }),
    staleTime: 10 * 60_000,
    retry: false,
    ...options,
  })
}

export function useAptRepositoryConfig(node: string, options?: QueryOpts<AptRepositories>) {
  return useQuery({
    queryKey: updateKeys.repositories(node),
    queryFn: ({ signal }) => get<AptRepositories>(p`/nodes/${node}/apt/repositories`, undefined, { signal }),
    staleTime: 30_000,
    retry: 1,
    ...options,
  })
}

// --------------------------------------------------------------- commands

/** apt-get update; returns a UPID. */
export function refreshPackageIndex(node: string): Promise<string> {
  return post<string>(p`/nodes/${node}/apt/update`)
}

/** Enable or disable one repository (path + index within the file). */
export function setRepositoryEnabled(
  node: string,
  repo: { path: string; index: number; enabled: boolean; digest?: string | undefined },
): Promise<null> {
  return post<null>(p`/nodes/${node}/apt/repositories`, {
    path: repo.path,
    index: repo.index,
    enabled: repo.enabled ? 1 : 0,
    digest: repo.digest,
  })
}

/** Add a standard repository by handle; an existing disabled entry is enabled instead. */
export function addStandardRepository(node: string, handle: string, digest?: string): Promise<null> {
  return put<null>(p`/nodes/${node}/apt/repositories`, { handle, digest })
}
