/** /pool/:poolid — nested pools ("parent/child") keep their slash as a path separator. */
export function poolPath(poolid: string): string {
  return `/pool/${poolid.split('/').map(encodeURIComponent).join('/')}`
}

/** Pool id from the route splat (React Router already decodes it). */
export function poolIdFromSplat(splat: string | undefined): string {
  return (splat ?? '').replace(/^\/+|\/+$/g, '')
}
