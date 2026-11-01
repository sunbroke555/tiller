import type { Params } from '@/api/client'
import type { ClusterOptions } from '@/api/guest-core'
import { parsePropertyString, stringifyPropertyString } from '@/lib/propstring'
import { parseTagStyle, splitTags } from '@/lib/tags'

import { parseUserTagAccess, TAG_RE } from './tags'

export function tagStyleString(options: ClusterOptions): string {
  const value = options['tag-style']
  return typeof value === 'string' ? value : stringifyPropertyString(value ?? {})
}

/** Change one colour while keeping all other colours and style settings. Empty = automatic. */
export function tagColorParams(options: ClusterOptions, tag: string, color: string): Params {
  if (!TAG_RE.test(tag)) throw new Error('标签名称无效')
  const hex = color.replace(/^#/, '').toUpperCase()
  if (hex && !/^[0-9A-F]{6}$/.test(hex)) throw new Error('请输入六位十六进制颜色，例如 #82BBDD')
  const raw = tagStyleString(options)
  const fields = parsePropertyString(raw)
  const { caseSensitive } = parseTagStyle(raw)
  const matches = (name: string) => caseSensitive ? name === tag : name.toLowerCase() === tag.toLowerCase()
  let replaced = false
  const colors = (fields['color-map'] ?? '').split(';').filter(Boolean).flatMap((entry) => {
    const [name = '', , ...textColor] = entry.split(':')
    if (!matches(name)) return [entry]
    if (!hex || replaced) return []
    replaced = true
    return [[name, hex, ...textColor].join(':')]
  })
  if (hex && !replaced) colors.push(`${tag}:${hex}`)
  fields['color-map'] = colors.join(';')
  const value = stringifyPropertyString(fields)
  return value ? { 'tag-style': value } : { delete: 'tag-style' }
}

/** Guest config permission is checked separately; registered tags still need Sys.Modify. */
export function tagAccessError(tag: string, options: ClusterOptions, usedTags: readonly string[], privileged: boolean): string | null {
  if (privileged) return null
  const { caseSensitive } = parseTagStyle(tagStyleString(options))
  const matches = (name: string) => caseSensitive ? name === tag : name.toLowerCase() === tag.toLowerCase()
  const registered = options['registered-tags']
  if ((Array.isArray(registered) ? registered : splitTags(registered)).some(matches)) return '此标签需要管理员权限'
  const access = parseUserTagAccess(options)
  if (access.mode === 'none') return '数据中心不允许当前用户添加标签'
  if (access.mode === 'free') return null
  const allowed = [...access.list, ...(options['allowed-tags'] ?? []), ...(access.mode === 'existing' ? usedTags : [])]
  return allowed.some(matches) ? null : '只能使用数据中心允许的标签'
}
