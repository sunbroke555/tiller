import { describe, expect, it } from 'vitest'

import { removeGuestTagParams, tagAccessError, tagColorParams } from './tagEditing'

describe('quick tag colours', () => {
  it('updates one colour while preserving other overrides, explicit text colours and unknown settings', () => {
    expect(tagColorParams({ 'tag-style': { 'color-map': 'Prod:112233:FFFFFF;other:AABBCC', shape: 'dense', ordering: 'config', future: 'keep' } }, 'prod', ' #82bbdd ')).toEqual({
      'tag-style': 'color-map=Prod:82BBDD:FFFFFF;other:AABBCC,shape=dense,ordering=config,future=keep',
    })
  })

  it('respects case-sensitive colour maps and restores only the selected tag to automatic', () => {
    const options = { 'tag-style': 'case-sensitive=1,color-map=Prod:112233;prod:AABBCC,shape=full' }
    expect(tagColorParams(options, 'prod', '')).toEqual({ 'tag-style': 'case-sensitive=1,color-map=Prod:112233,shape=full' })
    expect(tagColorParams({ 'tag-style': 'color-map=prod:AABBCC' }, 'prod', '')).toEqual({ delete: 'tag-style' })
    expect(tagColorParams({}, 'new', 'AABBCC')).toEqual({ 'tag-style': 'color-map=new:AABBCC' })
  })

  it('rejects invalid values before generating a config update', () => {
    expect(() => tagColorParams({}, 'a,b', 'AABBCC')).toThrow('标签名称无效')
    expect(() => tagColorParams({}, 'prod', 'bad-color')).toThrow('六位十六进制')
  })
})

describe('quick tag permissions', () => {
  it('honours user-tag-access and never offers registered tags to an ordinary user', () => {
    expect(tagAccessError('any', { 'user-tag-access': 'user-allow=none' }, [], false)).toContain('不允许')
    expect(tagAccessError('prod', { 'user-tag-access': 'user-allow=list,user-allow-list=prod' }, [], false)).toBeNull()
    expect(tagAccessError('other', { 'user-tag-access': 'user-allow=list,user-allow-list=prod' }, ['other'], false)).toContain('允许的标签')
    expect(tagAccessError('used', { 'user-tag-access': 'user-allow=existing' }, ['used'], false)).toBeNull()
    expect(tagAccessError('PROD', { 'registered-tags': ['prod'], 'allowed-tags': ['prod'] }, ['prod'], false)).toContain('管理员')
    expect(tagAccessError('prod', { 'registered-tags': 'prod', 'user-tag-access': 'user-allow=none' }, [], true)).toBeNull()
  })
})

describe('quick tag removal', () => {
  it('keeps concurrent tags, sends the current digest and respects case sensitivity', () => {
    const config = { tags: 'Prod;prod;concurrent', digest: 'latest', name: 'untouched' }
    expect(removeGuestTagParams(config, 'Prod', true)).toEqual({ tags: 'prod;concurrent', digest: 'latest' })
    expect(removeGuestTagParams(config, 'PROD', false)).toEqual({ tags: 'concurrent', digest: 'latest' })
    expect(removeGuestTagParams(config, 'missing', true)).toBeNull()
  })

  it('clears the last tag with delete=tags instead of an empty tags parameter', () => {
    expect(removeGuestTagParams({ tags: 'last', digest: 'latest' }, 'last', true)).toEqual({ delete: 'tags', digest: 'latest' })
    expect(removeGuestTagParams({}, 'already-removed', true)).toBeNull()
  })
})
