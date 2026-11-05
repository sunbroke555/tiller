// Disposable Tiller administrator and PVE connection for scripts/e2e-server.sh.
// This runs only on the test server; secrets stay in the private .run directory.
import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import path from 'node:path'

const [action, port] = process.argv.slice(2)
if (!/^\d+$/.test(port ?? '')) throw new Error('Invalid test port')
const file = path.resolve(import.meta.dirname, `../e2e/.run/server-${port}.connection.json`)
const base = `http://127.0.0.1:${port}`
const ssh = (host, command) => {
  if (!/^[\w.-]+$/.test(host) || host === '192.168.0.6') throw new Error('Refusing production or invalid lab host')
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', `root@${host}`, command], { encoding: 'utf8', timeout: 15_000 })
}
const removeToken = (connection) => {
  if (!/^e2e-tiller-\d+-[a-f0-9]+$/.test(connection.tokenName)) throw new Error('Invalid owned test token')
  ssh(connection.host, `pveum user token remove root@pam ${connection.tokenName}`)
}

if (action === 'stop') {
  try {
    const connection = JSON.parse(readFileSync(file, 'utf8'))
    removeToken(connection)
    rmSync(file)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
} else if (action === 'start') {
  const url = process.env.PVE_LAB_URL
  const host = new URL(url).hostname
  const tokenName = `e2e-tiller-${port}-${randomBytes(8).toString('hex')}`
  const username = 'e2e-admin'
  const password = randomBytes(24).toString('base64url')
  let created = false
  try {
    const token = JSON.parse(ssh(host, `pveum user token add root@pam ${tokenName} --privsep 0 --output-format json`))
    created = true
    // Persist ownership immediately, so stop can clean up after interruption.
    writeFileSync(file, JSON.stringify({ host, tokenName }), { mode: 0o600 })
    const setup = await fetch(base + '/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }), redirect: 'error' })
    if (!setup.ok) throw new Error(`Test administrator setup failed: HTTP ${setup.status}`)
    const { session } = await setup.json()
    const cookie = setup.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ')
    const added = await fetch(base + '/api2/tiller/instances', { method: 'POST', redirect: 'error', headers: { Cookie: cookie, CSRFPreventionToken: session.csrfToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'E2E Lab', url, fingerprint: process.env.PVE_LAB_FINGERPRINT, tokenId: token['full-tokenid'], tokenSecret: token.value }) })
    if (!added.ok) throw new Error(`Test instance setup failed: HTTP ${added.status}`)
    const instance = await added.json()
    writeFileSync(file, JSON.stringify({ username, password, instance, host, tokenName }), { mode: 0o600 })
  } catch (error) {
    if (created) { removeToken({ host, tokenName }); rmSync(file, { force: true }) }
    throw error
  }
} else throw new Error('Expected start or stop')
