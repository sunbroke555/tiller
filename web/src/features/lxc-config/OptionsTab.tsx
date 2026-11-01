import {
  ArrowDownUp,
  Box,
  Clock3,
  Cpu,
  FileCode2,
  Lock,
  Power,
  Puzzle,
  ShieldCheck,
  SquareTerminal,
  Terminal,
  TerminalSquare,
  UserRound,
  Variable,
  Webhook,
} from 'lucide-react'

import type { GuestTabProps } from '@/features/guest/types'

import { useDialog } from './hooks'
import { ARCHES, CMODE_LABEL, OSTYPES, describeFeatures, describeStartup, parseEnv, pendingOf } from './model'
import {
  EntrypointDialog,
  EnvDialog,
  FeaturesDialog,
  HookscriptDialog,
  SelectOptionDialog,
  StartupDialog,
  TimezoneDialog,
  TtyDialog,
} from './OptionDialogs'
import { ConfigRow, ConfigSection, PendingBanner, SwitchRow, TabBody, useLxcConfig, type LxcConfigApi } from './shared'

/** Options tab of a container. */
export default function OptionsTab(props: GuestTabProps) {
  const api = useLxcConfig(props)
  return (
    <TabBody api={api}>
      <OptionsBody api={api} />
    </TabBody>
  )
}

const OS_LABEL: Record<string, string> = {
  alpine: 'Alpine',
  archlinux: 'Arch Linux',
  centos: 'CentOS / RHEL 系',
  debian: 'Debian',
  devuan: 'Devuan',
  fedora: 'Fedora',
  gentoo: 'Gentoo',
  nixos: 'NixOS',
  opensuse: 'openSUSE',
  ubuntu: 'Ubuntu',
  unmanaged: '不管理（unmanaged）',
}

type SelectKey = 'ostype' | 'arch' | 'cmode'

function OptionsBody({ api }: { api: LxcConfigApi }) {
  const { cfg, config } = api
  const select = useDialog<SelectKey>()
  const startup = useDialog()
  const tty = useDialog()
  const features = useDialog()
  const hookscript = useDialog()
  const timezone = useDialog()
  const entrypoint = useDialog()
  const env = useDialog()
  const pending = (key: string) => pendingOf(config, key)
  const revert = (key: string) => () => void api.revert([key]).catch(() => undefined)
  /** Boolean option with a default: the default is stored as "not set". */
  const toggle = (key: string, def: boolean, label: string) => (on: boolean) =>
    api.save({ [key]: on === def ? undefined : on ? 1 : 0 }, `${on ? '开启' : '关闭'}${label}`)
  const flag = (key: string, def: boolean) => (cfg[key] === undefined ? def : cfg[key] === '1')
  const unprivileged = cfg.unprivileged === '1'
  const envVars = parseEnv(cfg.env)

  const selectSpec: Record<SelectKey, Omit<Parameters<typeof SelectOptionDialog>[0], 'open' | 'onOpenChange' | 'api' | 'configKey'>> = {
    ostype: {
      options: OSTYPES.map((o) => ({ value: o, label: OS_LABEL[o] ?? o, description: o })),
      hint: '决定 PVE 如何配置容器内的网络、主机名等。',
      warning: '通常只在创建时设置。改成不匹配的类型可能导致网络等配置失效。',
    },
    arch: {
      options: ARCHES.map((a) => ({ value: a, label: a })),
      warning: '架构必须与容器里安装的系统一致，否则容器无法启动。',
    },
    cmode: {
      options: Object.entries(CMODE_LABEL).map(([value, label]) => ({ value, label })),
      emptyOption: '默认（/dev/tty[X]）',
      hint: 'tty：连接一个可用的 tty；console：连接 /dev/console；shell：直接打开 shell（不需要登录）。',
    },
  }

  return (
    <>
      <PendingBanner api={api} tab="options" />

      <div className="grid gap-(--section-gap) lg:grid-cols-2">
        <ConfigSection title="启动与保护">
          <SwitchRow
            icon={Power}
            label="开机自启"
            description="节点启动时自动启动这个容器。"
            checked={flag('onboot', false)}
            pending={pending('onboot')}
            onChange={toggle('onboot', false, '开机自启')}
            onRevert={revert('onboot')}
          />
          <ConfigRow
            icon={ArrowDownUp}
            label="启动/关机顺序"
            value={describeStartup(cfg.startup)}
            muted={!cfg.startup}
            pending={pending('startup')}
            onEdit={() => startup.show(true)}
            onRevert={revert('startup')}
          />
          <SwitchRow
            icon={ShieldCheck}
            label="保护"
            description="防止误删容器或它的磁盘。"
            checked={flag('protection', false)}
            pending={pending('protection')}
            onChange={toggle('protection', false, '保护')}
            onRevert={revert('protection')}
          />
        </ConfigSection>

        <ConfigSection title="控制台">
          <SwitchRow
            icon={SquareTerminal}
            label="控制台设备"
            description="给容器提供 /dev/console。"
            checked={flag('console', true)}
            pending={pending('console')}
            onChange={toggle('console', true, '控制台设备')}
            onRevert={revert('console')}
          />
          <ConfigRow
            icon={Terminal}
            label="控制台模式"
            value={cfg.cmode ? (CMODE_LABEL[cfg.cmode] ?? cfg.cmode) : '默认（/dev/tty[X]）'}
            muted={!cfg.cmode}
            pending={pending('cmode')}
            onEdit={() => select.show('cmode')}
            onRevert={revert('cmode')}
          />
          <ConfigRow
            icon={TerminalSquare}
            label="TTY 数量"
            value={cfg.tty ?? '2（默认）'}
            muted={cfg.tty === undefined}
            pending={pending('tty')}
            onEdit={() => tty.show(true)}
            onRevert={revert('tty')}
          />
        </ConfigSection>
      </div>

      <ConfigSection title="系统">
        <ConfigRow
          icon={Box}
          label="系统类型"
          value={cfg.ostype ? (OS_LABEL[cfg.ostype] ?? cfg.ostype) : '未知'}
          pending={pending('ostype')}
          onEdit={() => select.show('ostype')}
          onRevert={revert('ostype')}
        />
        <ConfigRow
          icon={Cpu}
          label="架构"
          value={cfg.arch ?? 'amd64'}
          pending={pending('arch')}
          onEdit={() => select.show('arch')}
          onRevert={revert('arch')}
        />
        <ConfigRow
          icon={UserRound}
          label="非特权容器"
          value={unprivileged ? '是' : '否'}
          detail={unprivileged ? '容器内的 root 映射到主机上的普通用户。创建后不能修改。' : '特权容器：容器内的 root 就是主机的 root。创建后不能修改。'}
          badges={<Lock className="size-3.5 text-muted-foreground" aria-label="只读" />}
        />
        <ConfigRow
          icon={Puzzle}
          label="特性"
          value={describeFeatures(cfg.features)}
          muted={!cfg.features}
          pending={pending('features')}
          onEdit={() => features.show(true)}
          onRevert={revert('features')}
        />
        <ConfigRow
          icon={Clock3}
          label="时区"
          value={cfg.timezone ? (cfg.timezone === 'host' ? '跟随主机' : cfg.timezone) : '不设置'}
          muted={!cfg.timezone}
          pending={pending('timezone')}
          onEdit={() => timezone.show(true)}
          onRevert={revert('timezone')}
        />
      </ConfigSection>

      <ConfigSection title="高级">
        <ConfigRow
          icon={Webhook}
          label="钩子脚本"
          value={cfg.hookscript ?? '无'}
          muted={!cfg.hookscript}
          pending={pending('hookscript')}
          onEdit={() => hookscript.show(true)}
          onRevert={revert('hookscript')}
        />
        <ConfigRow
          icon={FileCode2}
          label="入口命令"
          value={<span className="font-mono text-[13px]">{cfg.entrypoint ?? '/sbin/init'}</span>}
          muted={!cfg.entrypoint}
          pending={pending('entrypoint')}
          onEdit={() => entrypoint.show(true)}
          onRevert={revert('entrypoint')}
        />
        <ConfigRow
          icon={Variable}
          label="环境变量"
          value={envVars.length ? `${envVars.length} 个变量` : '无'}
          detail={
            envVars.length ? (
              <span className="font-mono">{envVars.map((v) => `${v.name}=${v.value}`).join('  ')}</span>
            ) : undefined
          }
          muted={!envVars.length}
          pending={pending('env')}
          onEdit={() => env.show(true)}
          onRevert={revert('env')}
        />
      </ConfigSection>

      {select.data && (
        <SelectOptionDialog {...select.props} api={api} configKey={select.data} {...selectSpec[select.data]} />
      )}
      <StartupDialog {...startup.props} api={api} />
      <TtyDialog {...tty.props} api={api} />
      <FeaturesDialog {...features.props} api={api} />
      <HookscriptDialog {...hookscript.props} api={api} />
      <TimezoneDialog {...timezone.props} api={api} />
      <EntrypointDialog {...entrypoint.props} api={api} />
      <EnvDialog {...env.props} api={api} />
    </>
  )
}
