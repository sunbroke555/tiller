// Add / edit one external metric server (Graphite, InfluxDB, OpenTelemetry).

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { createMetricServer, fetchMetricServer, metricKeys, updateMetricServer, type MetricType } from '@/api/notifications-metrics'
import { FieldInput, FieldTextarea, FormDialog, FormField, FormRow, FormSection, NumberInput, SelectField, SwitchField } from '@/components/form'
import { runTask } from '@/components/tasks/tracker'
import { Skeleton } from '@/components/ui/skeleton'
import { Notice } from '@/features/storage-config/fields'
import { useOpenSnapshot } from '@/hooks/useOpenSnapshot'

import { METRIC_INFO, influxHttp, initialMetricForm, metricParams, validateMetric, type MetricForm } from './model'

export interface MetricServerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  type: MetricType
  id?: string | undefined
  canEdit: boolean
}

type Setter = <K extends keyof MetricForm>(k: K, v: MetricForm[K]) => void

export function MetricServerDialog({ open, onOpenChange, type, id, canEdit }: MetricServerDialogProps) {
  const create = !id
  const info = METRIC_INFO[type]
  const q = useQuery({
    queryKey: metricKeys.one(id ?? ''),
    queryFn: ({ signal }) => fetchMetricServer(id!, signal),
    enabled: open && !create,
    staleTime: 0,
  })
  const snap = useOpenSnapshot(open, q.data)

  const [form, setForm] = useState<MetricForm | null>(null)
  const [seeded, setSeeded] = useState<unknown>(null)
  const [tried, setTried] = useState(false)
  const source: unknown = create ? type : snap
  if (open && source && seeded !== source) {
    setSeeded(source)
    setForm(initialMetricForm(type, create ? undefined : snap))
    setTried(false)
  } else if (!open && seeded !== null) {
    setSeeded(null)
  }
  const set: Setter = (k, v) => setForm((f) => (f ? { ...f, [k]: v } : f))

  const errors = useMemo(() => (form ? validateMetric(form, create) : {}), [form, create])
  const err = (k: string) => (tried ? errors[k] : undefined)

  async function submit() {
    if (!form) return
    setTried(true)
    if (Object.keys(validateMetric(form, create)).length) throw new Error('请先修正标出的问题')
    if (create) {
      const n = form.id.trim()
      await runTask(createMetricServer(n, metricParams(form, true)), { title: `添加指标服务器 ${n}`, syncSuccessMessage: `已添加指标服务器 ${n}` })
    } else {
      await runTask(updateMetricServer(id, metricParams(form, false, snap?.digest)), {
        title: `保存指标服务器 ${id}`,
        syncSuccessMessage: `已保存指标服务器 ${id}`,
      })
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={create ? `添加 ${info.label} 服务器` : `${canEdit ? '编辑' : '查看'}指标服务器 ${id}`}
      description={create ? info.description : info.label}
      onSubmit={submit}
      submitLabel={create ? '添加' : '保存'}
      submitDisabled={!form || !canEdit}
    >
      {q.isError && !create ? (
        <Notice tone="error">读取配置失败：{q.error.message}</Notice>
      ) : !form ? (
        <div className="grid gap-3">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
        </div>
      ) : (
        <Fields f={form} set={set} create={create} err={err} />
      )}
    </FormDialog>
  )
}

function Fields({ f, set, create, err }: { f: MetricForm; set: Setter; create: boolean; err: (k: string) => string | undefined }) {
  const http = influxHttp(f)
  const udp = (f.type === 'graphite' && f.proto === 'udp') || (f.type === 'influxdb' && f.influxdbproto === 'udp')
  return (
    <>
      <FormRow>
        <FormField label="名称" name="id" required={create} error={err('id')} hint={create ? '创建后不能修改' : undefined}>
          <FieldInput value={f.id} onChange={(e) => set('id', e.target.value)} readOnly={!create} placeholder="例如 influx-main" className="font-mono" autoComplete="off" />
        </FormField>
        <div className="flex items-end pb-1">
          <SwitchField label="启用" checked={f.enable} onCheckedChange={(v) => set('enable', v)} />
        </div>
      </FormRow>
      <FormRow>
        <FormField label="服务器" name="server" required error={err('server')}>
          <FieldInput value={f.server} onChange={(e) => set('server', e.target.value)} placeholder={f.type === 'opentelemetry' ? 'otel-collector.example.com' : 'metrics.example.com'} autoComplete="off" inputMode="url" />
        </FormField>
        <FormField label="端口" name="port" required error={err('port')}>
          <NumberInput value={f.port} onChange={(v) => set('port', v)} min={1} max={65535} />
        </FormField>
      </FormRow>

      {f.type === 'graphite' && (
        <>
          <FormRow>
            <FormField label="协议" name="proto">
              <SelectField<'udp' | 'tcp'>
                value={f.proto}
                onValueChange={(v) => set('proto', v ?? 'udp')}
                options={[
                  { value: 'udp', label: 'UDP' },
                  { value: 'tcp', label: 'TCP' },
                ]}
              />
            </FormField>
            <FormField label="路径前缀" name="path" hint="指标名的根路径">
              <FieldInput value={f.path} onChange={(e) => set('path', e.target.value)} placeholder="proxmox" className="font-mono" autoComplete="off" />
            </FormField>
          </FormRow>
        </>
      )}

      {f.type === 'influxdb' && (
        <>
          <FormField label="协议" name="influxdbproto">
            <SelectField<'udp' | 'http' | 'https'>
              value={f.influxdbproto}
              onValueChange={(v) => set('influxdbproto', v ?? 'udp')}
              options={[
                { value: 'udp', label: 'UDP', description: 'InfluxDB 1.x 行协议' },
                { value: 'http', label: 'HTTP', description: 'v2 API' },
                { value: 'https', label: 'HTTPS', description: 'v2 API' },
              ]}
            />
          </FormField>
          {http && (
            <FormSection title="InfluxDB v2" description="InfluxDB 1.8 的 v2 兼容 API：组织留空，存储桶填 数据库/保留策略，Token 填 用户名:密码">
              <FormRow>
                <FormField label="组织" name="organization">
                  <FieldInput value={f.organization} onChange={(e) => set('organization', e.target.value)} placeholder="proxmox" autoComplete="off" />
                </FormField>
                <FormField label="存储桶" name="bucket">
                  <FieldInput value={f.bucket} onChange={(e) => set('bucket', e.target.value)} placeholder="proxmox" autoComplete="off" />
                </FormField>
              </FormRow>
              <FormField label="Token" name="token" hint={create ? undefined : '已保存的 Token 不显示，留空表示不变'}>
                <FieldInput type="password" value={f.token} onChange={(e) => set('token', e.target.value)} placeholder={create ? '' : '不变'} autoComplete="new-password" />
              </FormField>
            </FormSection>
          )}
        </>
      )}

      {f.type === 'opentelemetry' && (
        <>
          <FormRow>
            <FormField label="协议" name="otel-protocol">
              <SelectField<'http' | 'https'>
                value={f.otelProtocol}
                onValueChange={(v) => set('otelProtocol', v ?? 'https')}
                options={[
                  { value: 'https', label: 'HTTPS' },
                  { value: 'http', label: 'HTTP' },
                ]}
              />
            </FormField>
            <FormField label="路径" name="otel-path" required error={err('otel-path')}>
              <FieldInput value={f.otelPath} onChange={(e) => set('otelPath', e.target.value)} className="font-mono" autoComplete="off" />
            </FormField>
          </FormRow>
          <FormRow>
            <FormField label="超时" name="otel-timeout" error={err('otel-timeout')}>
              <NumberInput value={f.otelTimeout} onChange={(v) => set('otelTimeout', v)} min={1} max={10} unit="秒" />
            </FormField>
            <FormField label="压缩" name="otel-compression">
              <SelectField<'gzip' | 'none'>
                value={f.otelCompression}
                onValueChange={(v) => set('otelCompression', v ?? 'gzip')}
                options={[
                  { value: 'gzip', label: 'Gzip' },
                  { value: 'none', label: '不压缩' },
                ]}
              />
            </FormField>
          </FormRow>
          <SwitchField label="校验 TLS 证书" checked={f.otelVerifySsl} onCheckedChange={(v) => set('otelVerifySsl', v)} disabled={f.otelProtocol !== 'https'} />
        </>
      )}

      {f.enable && <Notice>启用时 PVE 会先测试连接（UDP 除外），连不上就无法保存。服务器还没准备好时，可以先关闭“启用”保存。</Notice>}

      <FormSection collapsible title="高级选项">
        {f.type === 'opentelemetry' ? (
          <>
            <FormField label="请求体上限" name="otel-max-body-size" error={err('otel-max-body-size')}>
              <NumberInput value={f.otelMaxBodySize} onChange={(v) => set('otelMaxBodySize', v)} min={1024} unit="字节" />
            </FormField>
            <FormField label="HTTP 请求头（JSON）" name="otel-headers" error={err('otel-headers')}>
              <FieldTextarea
                value={f.otelHeaders}
                onChange={(e) => set('otelHeaders', e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={'{ "Authorization": "Bearer token" }'}
                className="font-mono text-xs"
              />
            </FormField>
            <FormField label="资源属性（JSON）" name="otel-resource-attributes" error={err('otel-resource-attributes')}>
              <FieldTextarea
                value={f.otelResourceAttributes}
                onChange={(e) => set('otelResourceAttributes', e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={'{ "environment": "production" }'}
                className="font-mono text-xs"
              />
            </FormField>
          </>
        ) : (
          <>
            {udp && (
              <FormField label="MTU" name="mtu" error={err('mtu')} hint="UDP 包的大小上限">
                <NumberInput value={f.mtu} onChange={(v) => set('mtu', v)} min={512} max={65536} placeholder="1500" />
              </FormField>
            )}
            {((f.type === 'graphite' && f.proto === 'tcp') || http) && (
              <FormField label={f.type === 'graphite' ? 'TCP 超时' : '超时'} name="timeout">
                <NumberInput value={f.timeout} onChange={(v) => set('timeout', v)} min={1} unit="秒" placeholder="1" />
              </FormField>
            )}
            {http && (
              <>
                <FormField label="API 路径前缀" name="api-path-prefix" hint="InfluxDB 在反向代理后面时，插在 主机:端口/ 和 /api2/ 之间">
                  <FieldInput value={f.apiPathPrefix} onChange={(e) => set('apiPathPrefix', e.target.value)} className="font-mono" autoComplete="off" />
                </FormField>
                <FormField label="批量大小" name="max-body-size" hint="每个请求最多这么多字节">
                  <NumberInput value={f.maxBodySize} onChange={(v) => set('maxBodySize', v)} min={1} unit="字节" placeholder="25000000" />
                </FormField>
                <SwitchField
                  label="校验 TLS 证书"
                  checked={f.verifyCertificate}
                  onCheckedChange={(v) => set('verifyCertificate', v)}
                  disabled={f.influxdbproto !== 'https'}
                />
              </>
            )}
          </>
        )}
      </FormSection>
    </>
  )
}
