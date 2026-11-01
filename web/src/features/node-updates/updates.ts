// Pure logic of the updates tab: filtering and grouping the package list, and
// the repository view (rows per file, warnings, overall state) as computed by
// proxmoxlib.js (Proxmox.node.APT, Proxmox.node.APTRepositories).

import type { AptRepoInfo, AptRepositories, AptRepository, AptRepoOption, AptStandardRepo, AptUpdate } from '@/api/node-updates'

// ------------------------------------------------------------- package list

export interface UpdateGroup {
  /** Origin as reported by apt ("Proxmox", "Debian", …); "" when unknown. */
  origin: string
  items: AptUpdate[]
}

/** Case-insensitive match on package name, title, versions and (optionally) the long description. */
export function filterUpdates(list: readonly AptUpdate[], query: string, { description = false } = {}): AptUpdate[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return [...list]
  return list.filter((u) => {
    const hay = [u.Package, u.Title, u.Version, u.OldVersion, u.Origin, description ? u.Description : undefined]
      .filter(Boolean)
      .join('\n')
      .toLowerCase()
    return terms.every((t) => hay.includes(t))
  })
}

const ORIGIN_ORDER = ['Proxmox', 'Debian']

/** Group by origin like the official grid (Proxmox first, then Debian, others A–Z), packages A–Z. */
export function groupUpdates(list: readonly AptUpdate[]): UpdateGroup[] {
  const map = new Map<string, AptUpdate[]>()
  for (const u of list) {
    const origin = u.Origin?.trim() ?? ''
    const items = map.get(origin)
    if (items) items.push(u)
    else map.set(origin, [u])
  }
  const rank = (o: string) => {
    const i = ORIGIN_ORDER.findIndex((x) => x.toLowerCase() === o.toLowerCase())
    return i === -1 ? (o ? ORIGIN_ORDER.length : ORIGIN_ORDER.length + 1) : i
  }
  return [...map.entries()]
    .map(([origin, items]) => ({ origin, items: items.sort((a, b) => a.Package.localeCompare(b.Package)) }))
    .sort((a, b) => rank(a.origin) - rank(b.origin) || a.origin.localeCompare(b.origin))
}

/** Packages that need a reboot to take effect (kernels). */
export function isKernelPackage(name: string): boolean {
  return /^(?:proxmox|pve)-kernel-\d|^linux-image-\d/.test(name)
}

export function originLabel(origin: string): string {
  return origin || '其他'
}

// --------------------------------------------------------------- repositories

export type OriginType = 'Proxmox' | 'Debian' | 'Other'

export function classifyOrigin(origin: string | undefined): OriginType {
  const o = origin ?? ''
  if (/^\s*Proxmox\s*$/i.test(o)) return 'Proxmox'
  if (/^\s*Debian\s*(:?Backports)?$/i.test(o)) return 'Debian'
  return 'Other'
}

export interface RepoRow {
  /** "<path>#<index>", stable within one response. */
  key: string
  path: string
  index: number
  repo: AptRepository
  enabled: boolean
  /** Origin from the infos, "" when the API did not tell. */
  origin: string
  warnings: AptRepoInfo[]
}

export interface RepoFileGroup {
  path: string
  fileType: string
  rows: RepoRow[]
  /** Parse error of this file (it has no rows then). */
  error?: string
}

/** Truthy PVE flag (1, true, "1"). */
export function pveTrue(v: unknown): boolean {
  return v === 1 || v === true || v === '1'
}

/** Files with their repositories, origin and warnings attached (Proxmox.node.APTRepositories.reload). */
export function repoFileGroups(data: AptRepositories): RepoFileGroup[] {
  const infos = new Map<string, { origin: string; warnings: AptRepoInfo[] }>()
  for (const info of data.infos ?? []) {
    const key = `${info.path}#${info.index}`
    let entry = infos.get(key)
    if (!entry) {
      entry = { origin: '', warnings: [] }
      infos.set(key, entry)
    }
    if (info.kind === 'origin') entry.origin = info.message
    // Major upgrades are not allowed from the UI, so the pre-upgrade hint is a warning too.
    else if (info.kind === 'warning' || info.kind === 'ignore-pre-upgrade-warning') entry.warnings.push(info)
  }
  const groups: RepoFileGroup[] = (data.files ?? []).map((file) => ({
    path: file.path,
    fileType: file['file-type'],
    rows: file.repositories.map((repo, index) => {
      const info = infos.get(`${file.path}#${index}`)
      return {
        key: `${file.path}#${index}`,
        path: file.path,
        index,
        repo,
        enabled: pveTrue(repo.Enabled),
        origin: info?.origin ?? '',
        warnings: info?.warnings ?? [],
      }
    }),
  }))
  for (const err of data.errors ?? []) {
    const g = groups.find((x) => x.path === err.path)
    if (g) g.error = err.error
    else groups.push({ path: err.path, fileType: err.path.endsWith('.sources') ? 'sources' : 'list', rows: [], error: err.error })
  }
  return groups
}

/** The no-subscription / test hint on a repository's single component (the official grid's Components column). */
export function componentNotice(components: readonly string[] | undefined): { kind: 'no-subscription' | 'test'; message: string } | null {
  if (!components || components.length !== 1) return null
  const c = components[0]!
  // The official regex (\w+(-no-subscription|test)) misses Ceph's plain "no-subscription"; flag it too.
  if (!/(no-subscription|test)\s*$/i.test(c)) return null
  return /no-subscription/.test(c)
    ? { kind: 'no-subscription', message: 'no-subscription 软件源不适合生产环境' }
    : { kind: 'test', message: 'test 软件源可能包含不稳定的更新' }
}

/** Options as "Key: v1 v2" (deb822) or "key=v1,v2" (one-line style). */
export function formatRepoOptions(options: readonly AptRepoOption[] | undefined, fileType: string): string[] {
  return (options ?? []).map((o) => (fileType === 'list' ? `${o.Key}=${o.Values.join(',')}` : `${o.Key}: ${o.Values.join(' ')}`))
}

/** "deb http://… trixie pve-no-subscription": the repository as one line. */
export function repoOneLine(repo: AptRepository): string {
  return [repo.Types.join(' '), repo.URIs.join(' '), repo.Suites.join(' '), (repo.Components ?? []).join(' ')].filter(Boolean).join(' ')
}

export type RepoHealth = 'good' | 'warning' | 'critical'

export interface RepoMessage {
  status: RepoHealth
  message: string
}

export interface RepoState {
  status: RepoHealth
  /** Headline next to the status icon. */
  text: string
  messages: RepoMessage[]
}

export interface StandardRepoFlags {
  enterprise: boolean
  noSubscription: boolean
  test: boolean
  cephEnterprise: boolean
  cephNoSubscription: boolean
  cephTest: boolean
}

/** Which standard repositories are enabled (status 1). Any Ceph release counts for the Ceph flags. */
export function standardRepoFlags(repos: readonly AptStandardRepo[]): StandardRepoFlags {
  const on = (r: AptStandardRepo) => pveTrue(r.status)
  const any = (re: RegExp) => repos.some((r) => re.test(r.handle) && on(r))
  return {
    enterprise: any(/^enterprise$/),
    noSubscription: any(/^no-subscription$/),
    test: any(/^test$/),
    cephEnterprise: any(/^ceph-[a-zA-Z]+-enterprise$/),
    cephNoSubscription: any(/^ceph-[a-zA-Z]+-no-subscription$/),
    cephTest: any(/^ceph-[a-zA-Z]+-test$/),
  }
}

/**
 * Overall repository state and the messages of the status panel, same rules
 * as Proxmox.node.APTRepositories' updateState().
 */
export function repoState(data: AptRepositories, subscriptionActive: boolean, product = 'Proxmox VE'): RepoState {
  const messages: RepoMessage[] = []
  let status = 'good' as RepoHealth
  let text = '一切正常，已配置可用于生产环境的软件源。'
  let warnings = 0

  const addGood = (message: string) => messages.push({ status: 'good', message })
  const addWarn = (message: string) => {
    warnings++
    if (status !== 'critical') status = 'warning'
    messages.push({ status: 'warning', message })
  }
  const addCritical = (message: string, headline = '错误') => {
    status = 'critical'
    text = headline
    messages.push({ status: 'critical', message })
  }

  const errors = data.errors ?? []
  for (const e of errors) addCritical(`${e.path} - ${e.error}`)

  const f = standardRepoFlags(data['standard-repos'] ?? [])
  if (!f.enterprise && !f.noSubscription && !f.test) {
    addCritical(`没有启用任何 ${product} 软件源，无法获取更新！`, `没有启用 ${product} 软件源`)
  } else if (errors.length > 0) {
    // nothing extra: do not claim updates work
  } else if (f.enterprise && !f.noSubscription && !f.test && subscriptionActive) {
    addGood(`可以获取 ${product} 的受支持更新`)
  } else if (f.noSubscription || f.test) {
    addGood(`可以获取 ${product} 的更新`)
  }

  const suitesWarning = repoFileGroups(data).some((g) => g.rows.some((r) => r.enabled && r.warnings.some((w) => w.property === 'Suites')))
  if (suitesWarning) addWarn('部分软件源的套件（Suites）配置有误')

  const productionCheck = (enterprise: boolean, noSub: boolean, test: boolean, prefix: string, noSubAlt: string) => {
    if (!subscriptionActive && enterprise) addWarn(`已启用 ${prefix}enterprise 软件源，但没有有效订阅！`)
    if (noSub) addWarn(`不建议在生产环境使用 ${prefix}no-subscription${noSubAlt} 软件源！`)
    if (test) addWarn(`${prefix}test 软件源可能带来不稳定的更新，不建议在生产环境使用！`)
  }
  productionCheck(f.enterprise, f.noSubscription, f.test, '', '')
  productionCheck(f.cephEnterprise, f.cephNoSubscription, f.cephTest, 'Ceph ', '/main')

  if (errors.length > 0) text = '至少一个软件源文件解析失败'
  else if (status === 'warning') text = `${warnings} 条警告`
  return { status, text, messages }
}

/** Status of a standard repository for the add dialog. */
export function standardRepoStatus(repo: AptStandardRepo): 'missing' | 'enabled' | 'disabled' {
  if (repo.status === undefined || repo.status === null) return 'missing'
  return pveTrue(repo.status) ? 'enabled' : 'disabled'
}

export const STANDARD_REPO_STATUS_LABEL = {
  missing: '尚未配置',
  enabled: '已配置：已启用',
  disabled: '已配置：已禁用',
} as const

/** Chinese descriptions of the standard repositories (the API's text is English). */
export function standardRepoDescription(repo: AptStandardRepo): string {
  const h = repo.handle
  const ceph = /^ceph-([a-zA-Z]+)-(enterprise|no-subscription|test)$/.exec(h)
  if (ceph) {
    const release = ceph[1]!.charAt(0).toUpperCase() + ceph[1]!.slice(1)
    if (ceph[2] === 'enterprise') return `生产可用的 Proxmox Ceph ${release} 软件包。`
    if (ceph[2] === 'no-subscription') return `Proxmox Ceph ${release} 软件包，用于非生产环境。`
    return `尚未进入主仓库的 Ceph ${release} 软件包。`
  }
  if (h === 'enterprise') return '默认、稳定、推荐的软件源，提供给所有 Proxmox 订阅用户。'
  if (h === 'no-subscription') return '推荐用于测试和非生产环境。软件包没有企业版软件源测试得充分，不需要订阅。'
  if (h === 'test') return '包含最新的软件包，主要供测试实验室和开发者试用新功能。'
  return repo.description ?? ''
}
