import { describe, expect, it } from 'vitest'

import type { AcmeChallengeSchema } from '@/api/certificates-acme'

import {
  CUSTOM_DIRECTORY,
  accountChangeParams,
  accountFormErrors,
  accountRegisterParams,
  acmeDomains,
  activeCertificate,
  base64Utf8,
  buildPluginData,
  certValidity,
  compactIpv6,
  countCertificates,
  directoryMetaInfo,
  dnShortName,
  domainEditParams,
  domainRemoveParams,
  issuerKind,
  parseAcmeConfig,
  parseDn,
  parsePluginData,
  pluginDataToForm,
  pluginParams,
  printAcmeConfig,
  sanEntries,
  schemaFields,
  sortCertificates,
  splitPem,
  uploadParams,
  validateAcmeAlias,
  validateAcmeDomain,
  validateCertificateChain,
  validatePrivateKey,
  type AccountForm,
} from './model'

const CERT = '-----BEGIN CERTIFICATE-----\nMIIBAAA=\n-----END CERTIFICATE-----'
const CERT2 = '-----BEGIN CERTIFICATE-----\nMIICBBB=\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nMIIEvQ==\n-----END PRIVATE KEY-----'

describe('PEM handling', () => {
  it('splits a combined file into chain and key', () => {
    const split = splitPem(`junk\r\n${KEY}\n${CERT}\n\n${CERT2}\n`)
    expect(split.key).toBe(`${KEY}\n`)
    expect(split.certificates).toBe(`${CERT}\n${CERT2}\n`)
    expect(countCertificates(split.certificates)).toBe(2)
  })

  it('validates the chain', () => {
    expect(validateCertificateChain('')).toMatch('请填写')
    expect(validateCertificateChain('hello')).toMatch('没有找到')
    expect(validateCertificateChain(`${CERT}\n${KEY}`)).toMatch('私钥')
    expect(validateCertificateChain(CERT)).toBeNull()
  })

  it('validates the optional key', () => {
    expect(validatePrivateKey('')).toBeNull()
    expect(validatePrivateKey(KEY)).toBeNull()
    expect(validatePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')).toBeNull()
    expect(validatePrivateKey(CERT)).toMatch('不是证书')
    expect(validatePrivateKey(`${KEY}\n${KEY}`)).toMatch('一个')
    expect(validatePrivateKey('-----BEGIN ENCRYPTED PRIVATE KEY-----\nx\n-----END ENCRYPTED PRIVATE KEY-----')).toMatch('加密')
    expect(
      validatePrivateKey('-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nx\n-----END RSA PRIVATE KEY-----'),
    ).toMatch('加密')
  })

  it('builds upload params like the official UI (force, restart, key only when given)', () => {
    expect(uploadParams({ certificates: `  ${CERT}\r\n`, key: ' ', restart: true })).toEqual({
      certificates: `${CERT}\n`,
      force: 1,
      restart: 1,
    })
    expect(uploadParams({ certificates: CERT, key: KEY, restart: false })).toEqual({
      certificates: `${CERT}\n`,
      key: `${KEY}\n`,
      force: 1,
      restart: 0,
    })
  })
})

describe('certificate display', () => {
  const subject = '/OU=PVE Cluster Node/O=Proxmox Virtual Environment/CN=pvelab-c3.lan'
  it('parses one-line and RFC 2253 DNs', () => {
    expect(parseDn(subject)).toEqual([
      { key: 'OU', value: 'PVE Cluster Node' },
      { key: 'O', value: 'Proxmox Virtual Environment' },
      { key: 'CN', value: 'pvelab-c3.lan' },
    ])
    expect(dnShortName(subject)).toBe('pvelab-c3.lan')
    expect(dnShortName('C=US, O=Let\'s Encrypt, CN=R11')).toBe('R11')
    expect(dnShortName('/O=Only Org')).toBe('Only Org')
    expect(parseDn('/CN=a/b/O=x')).toEqual([
      { key: 'CN', value: 'a/b' },
      { key: 'O', value: 'x' },
    ])
  })

  it('lists SANs with IPv6 compacted and numbers dropped', () => {
    expect(
      sanEntries(['127.0.0.1', '0000:0000:0000:0000:0000:0000:0000:0001', 'localhost', 7, 'fe80:0000:0000:0000:0001:0000:0000:0002']),
    ).toEqual([
      { value: '127.0.0.1', kind: 'ip' },
      { value: '::1', kind: 'ip' },
      { value: 'localhost', kind: 'dns' },
      { value: 'fe80::1:0:0:2', kind: 'ip' },
    ])
    expect(compactIpv6('2001:0db8:0000:0001:0000:0000:0000:0000')).toBe('2001:db8:0:1::')
    expect(compactIpv6('pve.lan')).toBe('pve.lan')
    expect(sanEntries(undefined)).toEqual([])
  })

  it('computes validity', () => {
    const now = Date.UTC(2026, 10, 1) // 2026-11-01
    const s = now / 1000
    expect(certValidity({ notbefore: s - 10, notafter: s + 400 * 86400 }, now)).toMatchObject({ state: 'valid', daysLeft: 400 })
    expect(certValidity({ notbefore: s - 10, notafter: s + 10 * 86400 + 5 }, now)).toMatchObject({ state: 'expiring', label: '10 天后到期' })
    expect(certValidity({ notbefore: s - 99, notafter: s - 3 * 86400 }, now)).toMatchObject({ state: 'expired', label: '已过期 3 天' })
    expect(certValidity({ notbefore: s + 99, notafter: s + 900 * 86400 }, now).state).toBe('notyet')
    expect(certValidity({}, now).state).toBe('unknown')
    expect(certValidity({ notafter: s + 3650 * 86400 }, now).label).toBe('10 年后到期')
  })

  it('orders certificates and finds the active one', () => {
    const certs = [{ filename: 'pve-root-ca.pem' }, { filename: 'pve-ssl.pem' }, { filename: 'pveproxy-ssl.pem' }]
    expect(sortCertificates(certs).map((c) => c.filename)).toEqual(['pveproxy-ssl.pem', 'pve-ssl.pem', 'pve-root-ca.pem'])
    expect(activeCertificate(certs)).toBe('pveproxy-ssl.pem')
    expect(activeCertificate(certs.slice(0, 2))).toBe('pve-ssl.pem')
  })

  it('classifies issuers', () => {
    expect(issuerKind({ issuer: '/CN=Proxmox Virtual Environment/OU=x/O=PVE Cluster Manager CA', subject: '/CN=n' })).toBe('pve')
    expect(issuerKind({ issuer: '/C=US/O=(STAGING) Let\'s Encrypt/CN=(STAGING) Ersatz Edamame E1' })).toBe('acme-staging')
    expect(issuerKind({ issuer: '/C=US/O=Let\'s Encrypt/CN=R11' })).toBe('acme')
    expect(issuerKind({ issuer: '/CN=x', subject: '/CN=x' })).toBe('self')
  })
})

describe('ACME node config', () => {
  const config = {
    acme: 'account=prod,domains=a.example.com;b.example.com',
    acmedomain0: 'c.example.com,plugin=cf,alias=_acme-challenge.alias.net',
    acmedomain2: 'domain=d.example.com,plugin=ovh',
    digest: 'abc',
  }

  it('parses and prints the acme property', () => {
    expect(parseAcmeConfig(config.acme)).toEqual({ account: 'prod', domains: ['a.example.com', 'b.example.com'] })
    expect(parseAcmeConfig(undefined)).toEqual({ domains: [] })
    expect(printAcmeConfig({ account: 'x', domains: ['a.b', 'a.b', 'c.d'] })).toBe('account=x,domains=a.b;c.d')
    expect(printAcmeConfig({ domains: [] })).toBeNull()
  })

  it('lists the domains of a node', () => {
    expect(acmeDomains(config)).toEqual([
      { domain: 'a.example.com', type: 'standalone', configkey: 'acme' },
      { domain: 'b.example.com', type: 'standalone', configkey: 'acme' },
      { domain: 'c.example.com', type: 'dns', plugin: 'cf', alias: '_acme-challenge.alias.net', configkey: 'acmedomain0' },
      { domain: 'd.example.com', type: 'dns', plugin: 'ovh', configkey: 'acmedomain2' },
    ])
    // acmedomainN without plugin = standalone challenge
    expect(acmeDomains({ acmedomain1: 'e.example.com' })).toEqual([{ domain: 'e.example.com', type: 'standalone', configkey: 'acmedomain1' }])
  })

  it('adds HTTP and DNS domains', () => {
    expect(domainEditParams({}, undefined, { type: 'standalone', domain: ' pve.example.com ' })).toEqual({ acme: 'domains=pve.example.com' })
    expect(domainEditParams(config, undefined, { type: 'dns', domain: 'e.example.com', plugin: 'cf', alias: '' })).toEqual({
      digest: 'abc',
      acmedomain1: 'domain=e.example.com,plugin=cf',
    })
  })

  it('moves a domain between challenge types', () => {
    const http = acmeDomains(config)[0]!
    expect(domainEditParams(config, http, { type: 'dns', domain: 'a.example.com', plugin: 'cf' })).toEqual({
      digest: 'abc',
      acme: 'account=prod,domains=b.example.com',
      acmedomain1: 'domain=a.example.com,plugin=cf',
    })
    const dns = acmeDomains(config)[2]!
    expect(domainEditParams(config, dns, { type: 'standalone', domain: 'c.example.com' })).toEqual({
      digest: 'abc',
      acme: 'account=prod,domains=a.example.com;b.example.com;c.example.com',
      delete: 'acmedomain0',
    })
    // Editing a DNS domain in place keeps its slot.
    expect(domainEditParams(config, dns, { type: 'dns', domain: 'c2.example.com', plugin: 'ovh', alias: 'x.y' })).toEqual({
      digest: 'abc',
      acmedomain0: 'domain=c2.example.com,plugin=ovh,alias=x.y',
    })
  })

  it('moves the last HTTP domain to DNS and drops the empty acme property', () => {
    const cfg = { acme: 'domains=only.example.com' }
    expect(domainEditParams(cfg, acmeDomains(cfg)[0], { type: 'dns', domain: 'only.example.com', plugin: 'cf' })).toEqual({
      acmedomain0: 'domain=only.example.com,plugin=cf',
      delete: 'acme',
    })
  })

  it('rejects duplicates and full DNS slots', () => {
    expect(() => domainEditParams(config, undefined, { type: 'standalone', domain: 'C.example.com' })).toThrow('已经配置')
    const full = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`acmedomain${i}`, `d${i}.example.com,plugin=cf`]))
    expect(() => domainEditParams(full, undefined, { type: 'dns', domain: 'x.example.com', plugin: 'cf' })).toThrow('最多')
  })

  it('removes domains', () => {
    const [a, , c] = acmeDomains(config)
    expect(domainRemoveParams(config, a!)).toEqual({ digest: 'abc', acme: 'account=prod,domains=b.example.com' })
    expect(domainRemoveParams(config, c!)).toEqual({ digest: 'abc', delete: 'acmedomain0' })
    const one = { acme: 'domains=x.example.com' }
    expect(domainRemoveParams(one, acmeDomains(one)[0]!)).toEqual({ delete: 'acme' })
  })

  it('changes the account and keeps domains', () => {
    expect(accountChangeParams(config, 'e2e')).toEqual({ acme: 'account=e2e,domains=a.example.com;b.example.com', digest: 'abc' })
    expect(accountChangeParams(undefined, 'default')).toEqual({ acme: 'account=default' })
  })

  it('validates domains and aliases like PVE', () => {
    expect(validateAcmeDomain('pve.example.com')).toBeNull()
    expect(validateAcmeDomain('pve_1.example.com')).toBeNull()
    expect(validateAcmeDomain('pve')).toMatch('有效')
    expect(validateAcmeDomain('*.example.com')).toMatch('通配符')
    expect(validateAcmeDomain('-a.example.com')).toMatch('有效')
    expect(validateAcmeAlias('')).toBeNull()
    expect(validateAcmeAlias('_acme-challenge.example.net')).toBeNull()
    expect(validateAcmeAlias('nodot')).toMatch('有效')
  })
})

describe('ACME accounts', () => {
  const base: AccountForm = {
    name: '',
    contact: 'admin@example.org',
    directory: 'https://acme-staging-v02.api.letsencrypt.org/directory',
    customUrl: '',
    tosAccepted: true,
    eabKid: '',
    eabHmacKey: '',
  }
  const meta = directoryMetaInfo({ termsOfService: 'https://le/tos.pdf' })

  it('reads directory meta', () => {
    expect(meta).toEqual({ termsOfService: 'https://le/tos.pdf', eabRequired: false })
    expect(directoryMetaInfo({ externalAccountRequired: 1 })).toEqual({ termsOfService: undefined, eabRequired: true })
    expect(directoryMetaInfo(null)).toEqual({ termsOfService: undefined, eabRequired: false })
  })

  it('builds register params', () => {
    expect(accountRegisterParams(base, meta)).toEqual({
      contact: 'admin@example.org',
      directory: base.directory,
      tos_url: 'https://le/tos.pdf',
    })
    expect(
      accountRegisterParams(
        { ...base, name: 'zerossl', directory: CUSTOM_DIRECTORY, customUrl: ' https://acme.zerossl.com/v2/DV90 ', eabKid: 'kid', eabHmacKey: 'hmac' },
        { eabRequired: true },
      ),
    ).toEqual({ name: 'zerossl', contact: 'admin@example.org', directory: 'https://acme.zerossl.com/v2/DV90', 'eab-kid': 'kid', 'eab-hmac-key': 'hmac' })
  })

  it('validates the register form', () => {
    const opts = { defaultExists: false, existing: [] }
    expect(accountFormErrors(base, meta, opts)).toEqual({})
    expect(accountFormErrors({ ...base, tosAccepted: false }, meta, opts)).toHaveProperty('tos')
    expect(accountFormErrors(base, meta, { defaultExists: true, existing: ['default'] })).toHaveProperty('name')
    expect(accountFormErrors({ ...base, name: '1bad' }, meta, opts)).toHaveProperty('name')
    expect(accountFormErrors({ ...base, name: 'prod' }, meta, { defaultExists: false, existing: ['prod'] }).name).toMatch('已存在')
    expect(accountFormErrors({ ...base, contact: 'nope' }, meta, opts)).toHaveProperty('contact')
    expect(accountFormErrors({ ...base, directory: CUSTOM_DIRECTORY, customUrl: 'ftp://x' }, meta, opts)).toHaveProperty('directory')
    expect(accountFormErrors(base, { eabRequired: true }, opts)).toMatchObject({ 'eab-kid': expect.any(String), 'eab-hmac-key': expect.any(String) })
    expect(accountFormErrors({ ...base, eabKid: 'k' }, meta, opts)).toHaveProperty('eab-hmac-key')
  })
})

describe('ACME plugins', () => {
  const schema: AcmeChallengeSchema = {
    id: 'cf',
    name: 'Cloudflare Managed DNS',
    type: 'dns',
    schema: {
      fields: {
        CF_Token: { type: 'string', description: 'token' },
        CF_Account_ID: { type: 'string', name: 'Account ID' },
        CF_Zone_ID: { type: 'string', optional: 1, default: 'auto' },
      },
    },
  }

  it('turns the schema into sorted fields', () => {
    expect(schemaFields(schema)).toEqual([
      { key: 'CF_Account_ID', label: 'Account ID', type: 'string', optional: false },
      { key: 'CF_Token', label: 'CF_Token', type: 'string', description: 'token', optional: false },
      { key: 'CF_Zone_ID', label: 'CF_Zone_ID', type: 'string', defaultValue: 'auto', optional: true },
    ])
    expect(schemaFields(undefined)).toEqual([])
  })

  it('keeps everything after the first "=" of a value', () => {
    expect(parsePluginData('CF_Token=abc=def\n\nloose line\nX=')).toEqual({ values: { CF_Token: 'abc=def', X: '' }, extra: ['loose line'] })
  })

  it('round-trips data through the form', () => {
    const fields = schemaFields(schema)
    const form = pluginDataToForm('CF_Token=t=1\nCF_Account_ID=42\nOTHER=x\n', fields)
    expect(form).toEqual({ values: { CF_Token: 't=1', CF_Account_ID: '42' }, extra: 'OTHER=x' })
    expect(buildPluginData(fields, { ...form.values, CF_Zone_ID: ' ' }, form.extra + '\n\n')).toBe('CF_Account_ID=42\nCF_Token=t=1\nOTHER=x\n')
    expect(buildPluginData(fields, {}, '')).toBe('')
  })

  it('encodes data as UTF-8 base64', () => {
    expect(base64Utf8('A=1\n')).toBe('QT0xCg==')
    expect(atob(base64Utf8('K=中'))).toBe('K=ä¸­')
  })

  it('builds create params', () => {
    expect(pluginParams({ id: ' cf1 ', api: 'cf', validationDelay: null, data: 'A=1\n', nodes: [], disable: false })).toEqual({
      id: 'cf1',
      type: 'dns',
      api: 'cf',
      data: 'QT0xCg==',
    })
    expect(pluginParams({ id: 'cf1', api: 'cf', validationDelay: 120, data: '', nodes: ['n1', 'n2'], disable: true })).toEqual({
      id: 'cf1',
      type: 'dns',
      api: 'cf',
      data: '',
      'validation-delay': 120,
      nodes: 'n1,n2',
      disable: 1,
    })
  })

  it('builds edit params with deletes and digest', () => {
    const original = { plugin: 'cf1', type: 'dns', api: 'cf', 'validation-delay': 90, nodes: 'n1', disable: 1 as const, digest: 'd1' }
    expect(pluginParams({ id: '', api: 'cf', validationDelay: 30, data: 'A=1\n', nodes: [], disable: false }, original)).toEqual({
      api: 'cf',
      data: 'QT0xCg==',
      delete: 'validation-delay,nodes,disable',
      digest: 'd1',
    })
    expect(pluginParams({ id: '', api: 'ovh', validationDelay: 60, data: '', nodes: ['n2'], disable: true }, { plugin: 'p', type: 'dns' })).toEqual({
      api: 'ovh',
      data: '',
      'validation-delay': 60,
      nodes: 'n2',
      disable: 1,
    })
  })
})
