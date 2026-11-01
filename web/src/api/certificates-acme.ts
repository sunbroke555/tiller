// Certificates and ACME (certificates-acme): node certificate list, custom
// certificate upload/delete, the node's ACME domains (node config `acme` and
// `acmedomain0..4`), ordering / renewing / revoking the ACME certificate, and
// the cluster-wide ACME accounts and DNS challenge plugins.
//
// Endpoints follow pvemanagerlib.js (PVE.node.Certificates, PVE.node.ACME,
// PVE.node.ACMEAccountCreate, PVE.dc.ACMEClusterView) and proxmoxlib.js
// (Proxmox.panel.ACMEAccounts / ACMEPluginView, Proxmox.window.ACMEPluginEdit).
//
// Permissions (PVE 9): certificate info needs Sys.Audit on /nodes/{node};
// upload, delete, order, renew, revoke and the node config need Sys.Modify on
// /nodes/{node}; plugins need Sys.Modify on /; accounts can be listed by
// everyone but read, registered, updated and deactivated by root@pam only.

import { useQuery } from '@tanstack/react-query'

import { del, get, p, post, put, type Params } from './client'
import { queryKeys } from './queries'
import type { PveBool } from './types'

// ------------------------------------------------------------------ types

/** GET /nodes/{node}/certificates/info */
export interface CertificateInfo {
  /** "pve-root-ca.pem" | "pve-ssl.pem" | "pveproxy-ssl.pem" */
  filename: string
  /** SHA-256, colon separated upper-case hex. */
  fingerprint?: string
  /** OpenSSL one-line DN: "/CN=…/O=…". */
  issuer?: string
  subject?: string
  notbefore?: number
  notafter?: number
  /** DNS names and IP addresses (IPv6 uncompressed). */
  san?: (string | number)[]
  pem?: string
  'public-key-type'?: string
  'public-key-bits'?: number
}

/** The parts of GET /nodes/{node}/config this area reads. */
export interface NodeAcmeConfig {
  acme?: string
  acmedomain0?: string
  acmedomain1?: string
  acmedomain2?: string
  acmedomain3?: string
  acmedomain4?: string
  digest?: string
  [key: string]: unknown
}

/** GET /cluster/acme/directories */
export interface AcmeDirectory {
  name: string
  url: string
}

/** GET /cluster/acme/meta */
export interface AcmeDirectoryMeta {
  termsOfService?: string
  externalAccountRequired?: PveBool | boolean
  website?: string
  caaIdentities?: string[]
}

/** GET /cluster/acme/account/{name} */
export interface AcmeAccountDetail {
  account?: {
    contact?: string[]
    createdAt?: string
    status?: string
    [key: string]: unknown
  }
  directory?: string
  location?: string
  tos?: string
}

/** GET /cluster/acme/plugins */
export interface AcmePlugin {
  plugin: string
  type: 'dns' | 'standalone' | (string & {})
  api?: string
  /** Plain text KEY=value lines (base64 only on write). */
  data?: string
  digest?: string
  /** Comma separated node names. */
  nodes?: string
  disable?: PveBool
  'validation-delay'?: number
}

export interface AcmeSchemaField {
  type?: 'string' | 'integer' | 'number' | (string & {})
  name?: string
  description?: string
  default?: string | number
  optional?: PveBool
}

/** GET /cluster/acme/challenge-schema */
export interface AcmeChallengeSchema {
  id: string
  name: string
  type: string
  schema: {
    name?: string
    description?: string
    fields?: Record<string, AcmeSchemaField>
  }
}

// ------------------------------------------------------------- query keys

export const certKeys = {
  info: (node: string) => [...queryKeys.node(node), 'certificates', 'info'] as const,
  /** Same key as node-summary's node config: one cache entry per node. */
  nodeConfig: (node: string) => [...queryKeys.node(node), 'config'] as const,
  acme: () => [...queryKeys.all, 'cluster', 'acme'] as const,
  accounts: () => [...certKeys.acme(), 'account'] as const,
  account: (name: string) => [...certKeys.accounts(), name] as const,
  plugins: () => [...certKeys.acme(), 'plugins'] as const,
  plugin: (id: string) => [...certKeys.plugins(), id] as const,
  directories: () => ['acme', 'directories'] as const,
  meta: (directory: string) => ['acme', 'meta', directory] as const,
  schema: () => ['acme', 'challenge-schema'] as const,
}

// ---------------------------------------------------------------- queries

export function useCertificates(node: string) {
  return useQuery({
    queryKey: certKeys.info(node),
    queryFn: ({ signal }) => get<CertificateInfo[]>(p`/nodes/${node}/certificates/info`, undefined, { signal }),
    refetchInterval: 30_000,
  })
}

export function useNodeAcmeConfig(node: string) {
  return useQuery({
    queryKey: certKeys.nodeConfig(node),
    queryFn: ({ signal }) => get<NodeAcmeConfig>(p`/nodes/${node}/config`, undefined, { signal }),
    refetchInterval: 10_000,
  })
}

export function useAcmeAccounts() {
  return useQuery({
    queryKey: certKeys.accounts(),
    queryFn: ({ signal }) => get<{ name: string }[]>('/cluster/acme/account', undefined, { signal }),
    select: (list) => [...list].sort((a, b) => a.name.localeCompare(b.name)),
  })
}

export function useAcmeAccount(name: string | null, enabled = true) {
  return useQuery({
    queryKey: certKeys.account(name ?? ''),
    queryFn: ({ signal }) => get<AcmeAccountDetail>(p`/cluster/acme/account/${name ?? ''}`, undefined, { signal }),
    enabled: !!name && enabled,
    staleTime: 60_000,
  })
}

export function useAcmePlugins(enabled = true) {
  return useQuery({
    queryKey: certKeys.plugins(),
    queryFn: ({ signal }) => get<AcmePlugin[]>('/cluster/acme/plugins', undefined, { signal }),
    select: (list) => [...list].sort((a, b) => a.plugin.localeCompare(b.plugin)),
    enabled,
  })
}

export function useAcmePlugin(id: string | null) {
  return useQuery({
    queryKey: certKeys.plugin(id ?? ''),
    queryFn: ({ signal }) => get<AcmePlugin>(p`/cluster/acme/plugins/${id ?? ''}`, undefined, { signal }),
    enabled: !!id,
    staleTime: 0,
  })
}

export function useAcmeDirectories(enabled = true) {
  return useQuery({
    queryKey: certKeys.directories(),
    queryFn: ({ signal }) => get<AcmeDirectory[]>('/cluster/acme/directories', undefined, { signal }),
    staleTime: Infinity,
    enabled,
  })
}

/** Directory meta (ToS, EAB requirement); fetched by PVE from the CA. */
export function useAcmeMeta(directory: string | undefined) {
  return useQuery({
    queryKey: certKeys.meta(directory ?? ''),
    queryFn: ({ signal }) => get<AcmeDirectoryMeta | null>('/cluster/acme/meta', { directory }, { signal }),
    enabled: !!directory,
    staleTime: 10 * 60_000,
    retry: false,
  })
}

export function useAcmeChallengeSchema(enabled = true) {
  return useQuery({
    queryKey: certKeys.schema(),
    queryFn: ({ signal }) => get<AcmeChallengeSchema[]>('/cluster/acme/challenge-schema', undefined, { signal }),
    staleTime: Infinity,
    enabled,
  })
}

// -------------------------------------------------------------- mutations

export function uploadCustomCertificate(node: string, params: Params) {
  return post<null>(p`/nodes/${node}/certificates/custom`, params)
}

export function deleteCustomCertificate(node: string, restart: boolean) {
  return del<null>(p`/nodes/${node}/certificates/custom`, restart ? { restart: 1 } : undefined)
}

export function updateNodeAcmeConfig(node: string, params: Params) {
  return put<null>(p`/nodes/${node}/config`, params)
}

/** Order a new certificate (force: overwrite a custom one, as the official UI does). */
export function orderAcmeCertificate(node: string) {
  return post<string>(p`/nodes/${node}/certificates/acme/certificate`, { force: 1 })
}

export function renewAcmeCertificate(node: string, force: boolean) {
  return put<string>(p`/nodes/${node}/certificates/acme/certificate`, force ? { force: 1 } : undefined)
}

export function revokeAcmeCertificate(node: string) {
  return del<string>(p`/nodes/${node}/certificates/acme/certificate`)
}

export function registerAcmeAccount(params: Params) {
  return post<string>('/cluster/acme/account', params)
}

export function updateAcmeAccount(name: string, params: Params) {
  return put<string>(p`/cluster/acme/account/${name}`, params)
}

export function deactivateAcmeAccount(name: string) {
  return del<string>(p`/cluster/acme/account/${name}`)
}

export function createAcmePlugin(params: Params) {
  return post<null>('/cluster/acme/plugins', params)
}

export function updateAcmePlugin(id: string, params: Params) {
  return put<null>(p`/cluster/acme/plugins/${id}`, params)
}

export function deleteAcmePlugin(id: string) {
  return del<null>(p`/cluster/acme/plugins/${id}`)
}
