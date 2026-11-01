// Node certificates: list, details (subject, issuer, SANs, validity,
// fingerprint, PEM), upload and delete of the custom certificate.

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Copy, Download, KeyRound, Landmark, ShieldCheck, ShieldEllipsis, Trash2, Upload } from 'lucide-react'

import {
  certKeys,
  deleteCustomCertificate,
  uploadCustomCertificate,
  useCertificates,
  type CertificateInfo,
} from '@/api/certificates-acme'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { FieldTextarea, FormDialog, FormField, SwitchField } from '@/components/form'
import { ErrorState, LoadingRows } from '@/components/QueryState'
import { ResponsiveDialog } from '@/components/ResponsiveDialog'
import { runTask } from '@/components/tasks/tracker'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { copyText, downloadText } from '@/features/node-summary/clipboard'
import { formatDateTime } from '@/lib/format'
import { toast } from 'sonner'

import {
  CUSTOM_CERT_FILE,
  activeCertificate,
  certFileLabel,
  certValidity,
  countCertificates,
  dnShortName,
  issuerKind,
  keyTypeLabel,
  parseDn,
  sanEntries,
  sortCertificates,
  splitPem,
  uploadParams,
  validateCertificateChain,
  validatePrivateKey,
} from './model'
import { Fact, FileTextButton, HeaderButton, ListRow, NeutralPill, Notice, Section, ValidityPill } from './shared'

const ISSUER_LABEL: Record<ReturnType<typeof issuerKind>, string | null> = {
  self: '自签名',
  pve: '集群 CA',
  acme: 'ACME',
  'acme-staging': 'ACME 测试',
  other: null,
}

export function CertificatesSection({ node, canModify, isLocal }: { node: string; canModify: boolean; isLocal: boolean }) {
  const certs = useCertificates(node)
  const qc = useQueryClient()
  const [viewing, setViewing] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const list = sortCertificates(certs.data ?? [])
  const active = activeCertificate(list)
  const hasCustom = list.some((c) => c.filename === CUSTOM_CERT_FILE)
  const selected = list.find((c) => c.filename === viewing)

  /** pveproxy restarts in the background: look again once it is back. */
  const refetchSoon = () => {
    for (const ms of [4000, 10_000]) setTimeout(() => void qc.invalidateQueries({ queryKey: certKeys.info(node) }), ms)
  }

  const header = canModify ? (
    <HeaderButton icon={Upload} onClick={() => setUploadOpen(true)}>
      上传自定义证书
    </HeaderButton>
  ) : undefined

  return (
    <>
      <Section title="证书" action={header}>
        {certs.isPending ? (
          <LoadingRows rows={2} />
        ) : certs.isError && !certs.data ? (
          <ErrorState compact error={certs.error} onRetry={() => void certs.refetch()} title="无法读取证书" />
        ) : (
          list.map((c) => {
            const v = certValidity(c)
            const kind = issuerKind(c)
            const isCa = c.filename === 'pve-root-ca.pem'
            const issuerTag = ISSUER_LABEL[kind]
            return (
              <ListRow
                key={c.filename}
                icon={isCa ? Landmark : c.filename === active ? ShieldCheck : ShieldEllipsis}
                tone={v.state === 'expired' ? 'danger' : v.state === 'expiring' ? 'warning' : isCa ? 'muted' : 'brand'}
                title={certFileLabel(c.filename)}
                openLabel={`查看证书 ${c.filename}`}
                badges={
                  <>
                    {c.filename === active && <NeutralPill tone="brand">Web 界面使用中</NeutralPill>}
                    <ValidityPill state={v.state}>{v.label}</ValidityPill>
                  </>
                }
                meta={
                  <>
                    <span className="font-mono">{dnShortName(c.subject)}</span>
                    {!isCa && (
                      <>
                        {' · '}颁发者 {dnShortName(c.issuer)}
                        {issuerTag && kind !== 'pve' && kind !== 'self' ? `（${issuerTag}）` : ''}
                      </>
                    )}
                  </>
                }
                detail={
                  <span className="font-mono text-[11px]">
                    {c.filename} · {formatDateTime(c.notafter)} 到期
                  </span>
                }
                onOpen={() => setViewing(c.filename)}
                actions={
                  c.filename === CUSTOM_CERT_FILE && canModify
                    ? [
                        { id: 'view', label: '查看详情', icon: ShieldCheck, onSelect: () => setViewing(c.filename) },
                        { id: 'delete', label: '删除自定义证书', icon: Trash2, destructive: true, separated: true, onSelect: () => setDeleteOpen(true) },
                      ]
                    : []
                }
              />
            )
          })
        )}
      </Section>

      <CertificateDialog
        cert={selected}
        open={!!viewing}
        onOpenChange={(o) => !o && setViewing(null)}
        onDelete={canModify && selected?.filename === CUSTOM_CERT_FILE ? () => setDeleteOpen(true) : undefined}
      />

      <UploadDialog
        node={node}
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        hasCustom={hasCustom}
        isLocal={isLocal}
        onDone={refetchSoon}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        destructive
        title="删除自定义证书？"
        description={
          <>
            {node} 的 Web 界面将改回使用集群 CA 签发的 pve-ssl.pem，并重启 pveproxy。
            {isLocal && ' pve-web 通过这个节点连接 PVE，重启期间会短暂断开；如果固定了 PVE_TLS_FINGERPRINT，需要改成新证书的指纹。'}
          </>
        }
        confirmLabel="删除"
        onConfirm={async () => {
          await runTask(deleteCustomCertificate(node, true), {
            title: `删除自定义证书（${node}）`,
            invalidate: [certKeys.info(node)],
            syncSuccessMessage: `已删除 ${node} 的自定义证书，pveproxy 正在重启`,
          })
          setViewing(null)
          refetchSoon()
        }}
      />
    </>
  )
}

// ------------------------------------------------------------- details

function CertificateDialog({
  cert,
  open,
  onOpenChange,
  onDelete,
}: {
  cert: CertificateInfo | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onDelete?: (() => void) | undefined
}) {
  const [pemOpen, setPemOpen] = useState(false)
  const v = cert ? certValidity(cert) : null
  const sans = sanEntries(cert?.san)
  const subject = parseDn(cert?.subject)
  const issuer = parseDn(cert?.issuer)
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setPemOpen(false)
        onOpenChange(o)
      }}
      size="lg"
      title={cert ? certFileLabel(cert.filename) : '证书'}
      description={cert && <span className="font-mono">{cert.filename}</span>}
      headerExtra={v && <ValidityPill state={v.state}>{v.label}</ValidityPill>}
      footer={
        <>
          {onDelete && (
            <Button variant="outline" className="mr-auto text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 /> 删除自定义证书
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </>
      }
      bodyClassName="grid gap-3"
    >
      {cert && (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            <Fact label="主题" wide>
              <DnList parts={subject} raw={cert.subject} />
            </Fact>
            <Fact label="颁发者" wide>
              <DnList parts={issuer} raw={cert.issuer} />
            </Fact>
            <Fact label="生效时间">
              <span className="tabular">{formatDateTime(cert.notbefore)}</span>
            </Fact>
            <Fact label="到期时间">
              <span className="tabular">{formatDateTime(cert.notafter)}</span>
            </Fact>
            <Fact label="公钥">{keyTypeLabel(cert)}</Fact>
            <Fact label="备用名称（SAN）">{sans.length ? `${sans.length} 个` : '无'}</Fact>
          </div>

          {sans.length > 0 && (
            <div className="grid gap-1.5">
              <h3 className="text-xs text-muted-foreground">备用名称（SAN）</h3>
              <ul aria-label="备用名称" className="flex flex-wrap gap-1.5">
                {sans.map((s) => (
                  <li
                    key={s.value}
                    className="rounded-lg bg-foreground/[0.04] px-2 py-1 font-mono text-xs ring-1 ring-border/60 ring-inset paper:bg-secondary/60"
                  >
                    <span className="mr-1 text-[10px] text-muted-foreground uppercase">{s.kind === 'ip' ? 'IP' : 'DNS'}</span>
                    {s.value}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {cert.fingerprint && (
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs text-muted-foreground">SHA-256 指纹</h3>
                <Button variant="ghost" size="sm" className="h-8 pointer-coarse:h-10" onClick={() => void copyText(cert.fingerprint!, '已复制指纹')}>
                  <Copy /> 复制
                </Button>
              </div>
              <p aria-label="指纹" className="rounded-xl bg-foreground/[0.03] px-3 py-2 font-mono text-xs leading-relaxed break-all ring-1 ring-border/60 ring-inset paper:bg-secondary/50">
                {cert.fingerprint}
              </p>
            </div>
          )}

          {cert.pem && (
            <Collapsible open={pemOpen} onOpenChange={setPemOpen} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <CollapsibleTrigger asChild>
                  <Button variant="outline" size="sm" className="pointer-coarse:h-10">
                    <KeyRound /> {pemOpen ? '收起 PEM' : '显示 PEM'}
                  </Button>
                </CollapsibleTrigger>
                <Button variant="ghost" size="sm" className="pointer-coarse:h-10" onClick={() => void copyText(cert.pem!, '已复制 PEM')}>
                  <Copy /> 复制
                </Button>
                <Button variant="ghost" size="sm" className="pointer-coarse:h-10" onClick={() => downloadText(cert.pem!, cert.filename)}>
                  <Download /> 下载
                </Button>
              </div>
              <CollapsibleContent>
                <pre
                  aria-label="PEM"
                  className="max-h-72 overflow-auto rounded-xl bg-foreground/[0.03] p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap ring-1 ring-border/60 ring-inset paper:bg-secondary/50"
                >
                  {cert.pem}
                </pre>
              </CollapsibleContent>
            </Collapsible>
          )}
        </>
      )}
    </ResponsiveDialog>
  )
}

const DN_KEY_LABEL: Record<string, string> = { CN: '通用名', O: '组织', OU: '部门', C: '国家', ST: '省/州', L: '城市', emailAddress: '邮箱' }

function DnList({ parts, raw }: { parts: { key: string; value: string }[]; raw: string | undefined }) {
  if (!parts.length) return <span className="font-mono">{raw || '—'}</span>
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      {parts.map((p, i) => (
        <div key={i} className="contents">
          <dt className="text-muted-foreground" title={p.key}>
            {DN_KEY_LABEL[p.key] ?? p.key}
          </dt>
          <dd className="min-w-0 font-mono break-all">{p.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// --------------------------------------------------------------- upload

function UploadDialog({
  node,
  open,
  onOpenChange,
  hasCustom,
  isLocal,
  onDone,
}: {
  node: string
  open: boolean
  onOpenChange: (open: boolean) => void
  hasCustom: boolean
  isLocal: boolean
  onDone: () => void
}) {
  const [certificates, setCertificates] = useState('')
  const [key, setKey] = useState('')
  const [restart, setRestart] = useState(true)
  const [showErrors, setShowErrors] = useState(false)
  const [lastOpen, setLastOpen] = useState(open)
  if (open !== lastOpen) {
    setLastOpen(open)
    if (open) {
      setCertificates('')
      setKey('')
      setRestart(true)
      setShowErrors(false)
    }
  }

  const certError = validateCertificateChain(certificates)
  const keyError = validatePrivateKey(key)
  const count = countCertificates(certificates)

  /** A combined file fills both fields. */
  const takeText = (text: string, target: 'cert' | 'key', name: string) => {
    const split = splitPem(text)
    if (target === 'cert') {
      setCertificates(split.certificates || text)
      if (split.key) {
        setKey(split.key)
        toast.info(`${name} 里也有私钥，已一并填入`)
      }
    } else {
      setKey(split.key || text)
      if (split.certificates && !certificates.trim()) {
        setCertificates(split.certificates)
        toast.info(`${name} 里也有证书，已一并填入`)
      }
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="上传自定义证书"
      description={`替换 ${node} 的 Web 界面（pveproxy）证书`}
      submitLabel="上传"
      dirty={!!(certificates || key)}
      onSubmit={async () => {
        setShowErrors(true)
        if (certError || keyError) throw new Error(certError ?? keyError ?? '')
        await runTask(uploadCustomCertificate(node, uploadParams({ certificates, key, restart })), {
          title: `上传自定义证书（${node}）`,
          invalidate: [certKeys.info(node)],
          syncSuccessMessage: restart ? `证书已上传，${node} 的 pveproxy 正在重启` : '证书已上传，重启 pveproxy 后生效',
        })
        onDone()
      }}
    >
      <FormField
        label="证书链（PEM）"
        name="certificates"
        required
        error={showErrors ? certError : undefined}
        hint={count > 0 ? `${count} 个证书：服务器证书在前，中间证书在后` : '服务器证书在前，中间证书依次在后'}
        labelExtra={<FileTextButton accept=".pem,.crt,.cer,.cert,.txt" onText={(t, n) => takeText(t, 'cert', n)} />}
      >
        <FieldTextarea
          value={certificates}
          onChange={(e) => setCertificates(e.target.value)}
          placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'}
          className="min-h-32 font-mono text-xs"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </FormField>
      <FormField
        label="私钥（PEM，可选）"
        name="key"
        error={showErrors ? keyError : undefined}
        hint={hasCustom ? '留空则沿用当前自定义证书的私钥。私钥不能加密。' : '必须与证书匹配，且不能加密。'}
        labelExtra={<FileTextButton accept=".pem,.key,.txt" onText={(t, n) => takeText(t, 'key', n)} />}
      >
        <FieldTextarea
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={hasCustom ? '不修改' : '-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----'}
          className="min-h-24 font-mono text-xs"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
        />
      </FormField>
      <SwitchField
        label="上传后重启 pveproxy"
        description="新证书在 pveproxy 重启后生效，正在使用的网页连接会断开几秒。"
        checked={restart}
        onCheckedChange={setRestart}
      />
      {hasCustom && (
        <Notice icon={AlertTriangle}>会覆盖当前的自定义证书（包括 ACME 申请的证书）。</Notice>
      )}
      {isLocal && (
        <Notice icon={AlertTriangle} tone="warning">
          pve-web 通过 {node} 连接 PVE。如果 pve-web 用 PVE_TLS_FINGERPRINT 固定了证书指纹，换证书后要同步修改，否则会连不上。
        </Notice>
      )}
    </FormDialog>
  )
}
