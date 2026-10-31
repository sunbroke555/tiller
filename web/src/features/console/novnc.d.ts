// Minimal types for the parts of noVNC (@novnc/novnc 1.7, core/rfb.js) we
// use. See node_modules/@novnc/novnc/docs/API.md.

declare module '@novnc/novnc' {
  export interface RfbCredentials {
    username?: string
    password?: string
    target?: string
  }

  export interface RfbOptions {
    shared?: boolean
    credentials?: RfbCredentials
    repeaterID?: string
    wsProtocols?: string[]
  }

  export interface RfbEventMap {
    connect: CustomEvent<Record<string, never>>
    disconnect: CustomEvent<{ clean: boolean }>
    credentialsrequired: CustomEvent<{ types: string[] }>
    securityfailure: CustomEvent<{ status: number; reason?: string }>
    clipboard: CustomEvent<{ text: string }>
    bell: CustomEvent<Record<string, never>>
    desktopname: CustomEvent<{ name: string }>
    capabilities: CustomEvent<{ capabilities: { power: boolean } }>
    serververification: CustomEvent<{ type: string; publickey?: Uint8Array }>
  }

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions)

    viewOnly: boolean
    focusOnClick: boolean
    clipViewport: boolean
    dragViewport: boolean
    scaleViewport: boolean
    resizeSession: boolean
    showDotCursor: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    readonly capabilities: { power: boolean }

    disconnect(): void
    sendCredentials(credentials: RfbCredentials): void
    sendKey(keysym: number, code: string | null, down?: boolean): void
    sendCtrlAltDel(): void
    focus(options?: FocusOptions): void
    blur(): void
    clipboardPasteFrom(text: string): void
    machineShutdown(): void
    machineReboot(): void
    machineReset(): void

    addEventListener<K extends keyof RfbEventMap>(type: K, listener: (ev: RfbEventMap[K]) => void): void
    addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ): void
    removeEventListener<K extends keyof RfbEventMap>(type: K, listener: (ev: RfbEventMap[K]) => void): void
    removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ): void
  }
}
