import { describe, expect, it } from 'vitest'

import { collectTags, contrastText, hasAllTags, orderTags, parseTagStyle, splitTags, stringToRgb, tagColors } from './tags'

describe('tag colours', () => {
  it('matches Proxmox.Utils.stringToRGB', () => {
    // Reference values computed with the official function.
    const ref = (s: string) => {
      let hash = 0
      const str = s + 'prox'
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash)
        hash = hash & hash
      }
      const alpha = 0.7
      const bg = 255
      return [
        (hash & 255) * alpha + bg * (1 - alpha),
        ((hash >> 8) & 255) * alpha + bg * (1 - alpha),
        ((hash >> 16) & 255) * alpha + bg * (1 - alpha),
      ]
    }
    for (const t of ['test', 'demo', 'prod', '数据库', 'a']) expect(stringToRgb(t)).toEqual(ref(t))
  })

  it('picks readable text', () => {
    expect(contrastText([255, 255, 255])).toBe('dark')
    expect(contrastText([0, 0, 0])).toBe('light')
    expect(contrastText([200, 230, 255])).toBe('dark')
  })
})

describe('tag-style', () => {
  it('parses the datacenter option', () => {
    const s = parseTagStyle('color-map=Prod:FF0000:FFFFFF;test:00aa00,shape=circle,ordering=alphabetical,case-sensitive=0')
    expect(s.shape).toBe('circle')
    expect(s.ordering).toBe('alphabetical')
    expect(s.caseSensitive).toBe(false)
    expect(s.colorMap.prod).toEqual({ bg: [255, 0, 0], fg: [255, 255, 255] })
    expect(s.colorMap.test).toEqual({ bg: [0, 170, 0] })
    expect(tagColors('PROD', s)).toEqual({ base: [255, 0, 0], fg: [255, 255, 255], override: true })
    expect(tagColors('other', s).override).toBe(false)
  })

  it('defaults and ignores junk', () => {
    expect(parseTagStyle(undefined)).toEqual({ colorMap: {}, shape: 'full', ordering: 'config', caseSensitive: false })
    expect(parseTagStyle('shape=weird,color-map=x:nothex').colorMap).toEqual({})
    const cs = parseTagStyle('case-sensitive=1,color-map=Prod:FF0000')
    expect(tagColors('prod', cs).override).toBe(false)
    expect(tagColors('Prod', cs).override).toBe(true)
  })
})

describe('tag lists', () => {
  it('splits, orders and dedupes', () => {
    expect(splitTags('test;demo, x  y')).toEqual(['test', 'demo', 'x', 'y'])
    expect(orderTags(['b', 'A', 'a'])).toEqual(['b', 'A'])
    expect(orderTags(['b', 'a'], parseTagStyle('ordering=alphabetical'))).toEqual(['a', 'b'])
  })

  it('collects and filters', () => {
    const items = [{ tags: 'test;demo' }, { tags: 'Demo' }, {}]
    expect(collectTags(items)).toEqual([
      { tag: 'demo', count: 2 },
      { tag: 'test', count: 1 },
    ])
    expect(hasAllTags({ tags: 'test;Demo' }, ['demo', 'test'])).toBe(true)
    expect(hasAllTags({ tags: 'test' }, ['demo'])).toBe(false)
    expect(hasAllTags({}, [])).toBe(true)
  })
})
