/** /datacenter/backup, or /datacenter/backup/<id> for a job's detail page. */
export function jobPath(id?: string): string {
  return id === undefined ? '/datacenter/backup' : `/datacenter/backup/${encodeURIComponent(id)}`
}
