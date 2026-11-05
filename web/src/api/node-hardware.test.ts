import { describe, expect, it, vi } from 'vitest'
import { readHardwareResponse } from './node-hardware'

describe('hardware connection progress', () => {
  it('reports UTF-8 progress before the final result, across arbitrary network chunks', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(new ReadableStream({ start(c) { controller = c } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    const onLog = vi.fn()
    const result = readHardwareResponse(response, onLog)
    const encoder = new TextEncoder()
    const line = encoder.encode(JSON.stringify({ type: 'log', at: '2026-11-02T01:00:00Z', message: '正在安装采集服务' }) + '\n')
    for (const byte of line) controller.enqueue(new Uint8Array([byte]))
    await vi.waitFor(() => expect(onLog).toHaveBeenCalledWith({ at: '2026-11-02T01:00:00Z', message: '正在安装采集服务' }))
    controller.enqueue(encoder.encode('{"type":"heartbeat"}\n{"type":"result","status":409,"data":{"needsInstall":true}}\n'))
    await expect(result).resolves.toEqual({ status: 409, data: { needsInstall: true } })
  })

  it('rejects a truncated stream instead of reporting successful installation', async () => {
    const response = new Response('{"type":"log","at":"2026-11-02T01:00:00Z","message":"正在启动"}\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
    await expect(readHardwareResponse(response)).rejects.toThrow('连接已中断')
  })

  it('keeps operation state uncertain when the network stream breaks', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('network disconnected')) } }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    await expect(readHardwareResponse(response)).rejects.toMatchObject({ diagnostic: { code: 'PROGRESS_INTERRUPTED', state: '节点操作可能仍在进行，不能据此确认成功或失败。' } })
  })

  it('preserves a streamed failure and supports normal JSON errors', async () => {
    const data = { message: '节点授权失败', diagnostic: { code: 'PVE_ACCESS_DENIED', stage: '验证节点管理员授权', reason: 'PVE 拒绝了本次授权', suggestion: '检查密码', state: '节点采集操作尚未执行。' } }
    const response = new Response(JSON.stringify({ type: 'result', status: 403, data }), { headers: { 'Content-Type': 'application/x-ndjson' } })
    await expect(readHardwareResponse(response)).resolves.toEqual({ status: 403, data })
    await expect(readHardwareResponse(new Response(JSON.stringify(data), { status: 401, headers: { 'Content-Type': 'application/json' } }))).resolves.toEqual({ status: 401, data })
  })
})
