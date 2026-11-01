// Index text and browser queries share word boundaries without sending a
// serialized function through VitePress site data (which would need eval).
export function segmentChinese(text: string): string {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
  return text.replace(/\p{Script=Han}+/gu, (run) =>
    ` ${Array.from(segmenter.segment(run), (part) => part.segment).join(' ')} `)
}

export function tokenizeSearch(text: string): string[] {
  // Same Unicode boundaries as MiniSearch's default tokenizer, with Chinese
  // word breaks added. Configuration names use the default boundary rules.
  return segmentChinese(text).split(/[\n\r\p{Z}\p{P}]+/u).filter(Boolean)
}
