// Pickers used by the VM config editors: a searchable select for long lists
// (CPU models, PCI devices), storage volumes, disk target and bus/slot.

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'

import { useStorageFormats, useStorageVolumes, type NodeStorageWithFormats } from '@/api/qemu-config'
import { FormField, FormRow, NumberInput, SelectField, useFieldControl, type SelectOption } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'

import { BUS_LABEL, BUS_MAX, DISK_FORMAT_LABEL } from './constants'

// ---------------------------------------------------------- search select

export interface SearchOption {
  value: string
  label: string
  description?: string
  group?: string
  /** Extra text matched by the search. */
  keywords?: string[]
}

export interface SearchSelectProps {
  value: string | undefined
  onValueChange: (value: string | undefined) => void
  options: readonly SearchOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Label of a "not set" choice at the top. */
  emptyOption?: string
  loading?: boolean
  disabled?: boolean
  /** Allow a typed value that is not in the list (e.g. a custom USB id). */
  allowCustom?: boolean
  className?: string
}

/** Select with a search box for long lists. */
export function SearchSelect({
  value,
  onValueChange,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索…',
  emptyOption,
  loading,
  disabled,
  allowCustom,
  className,
}: SearchSelectProps) {
  const control = useFieldControl()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = options.find((o) => o.value === value)
  const groups = useMemo(() => {
    const map = new Map<string, SearchOption[]>()
    for (const o of options) {
      const g = o.group ?? ''
      map.set(g, [...(map.get(g) ?? []), o])
    }
    return [...map.entries()]
  }, [options])

  const label = selected?.label ?? (value ? value : loading ? '加载中…' : emptyOption && !value ? emptyOption : placeholder)
  const custom = allowCustom && search.trim() && !options.some((o) => o.value === search.trim()) ? search.trim() : null

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || control.disabled || loading}
          id={control.id}
          aria-describedby={control['aria-describedby']}
          aria-invalid={control['aria-invalid']}
          className={cn(
            'w-full min-w-0 justify-between bg-(--field) px-3 font-normal',
            !selected && !value && 'text-muted-foreground',
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-72 p-0">
        <Command
          filter={(itemValue, query, keywords) => {
            const q = query.trim().toLowerCase()
            if (!q) return 1
            const hay = [itemValue, ...(keywords ?? [])].join(' ').toLowerCase()
            return hay.includes(q) ? 1 : 0
          }}
        >
          <CommandInput value={search} onValueChange={setSearch} placeholder={searchPlaceholder} className="pointer-coarse:h-11" />
          <CommandList className="max-h-[min(20rem,50dvh)]">
            <CommandEmpty>{custom ? null : '没有匹配项'}</CommandEmpty>
            {custom && (
              <CommandGroup>
                <CommandItem
                  value={`custom:${custom}`}
                  onSelect={() => {
                    onValueChange(custom)
                    setOpen(false)
                  }}
                  className="pointer-coarse:py-2.5"
                >
                  使用“{custom}”
                </CommandItem>
              </CommandGroup>
            )}
            {emptyOption && (
              <CommandGroup>
                <CommandItem
                  value="__empty__"
                  keywords={[emptyOption]}
                  onSelect={() => {
                    onValueChange(undefined)
                    setOpen(false)
                  }}
                  className="pointer-coarse:py-2.5"
                >
                  <Check className={cn(value ? 'opacity-0' : 'opacity-100')} />
                  <span className="text-muted-foreground">{emptyOption}</span>
                </CommandItem>
              </CommandGroup>
            )}
            {groups.map(([group, items]) => (
              <CommandGroup key={group || '_'} heading={group || undefined}>
                {items.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    keywords={[o.label, o.description ?? '', ...(o.keywords ?? [])]}
                    onSelect={() => {
                      onValueChange(o.value)
                      setOpen(false)
                    }}
                    className="pointer-coarse:py-2.5"
                  >
                    <Check className={cn(o.value === value ? 'opacity-100' : 'opacity-0')} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.description && <span className="ml-2 shrink-0 truncate text-xs text-muted-foreground">{o.description}</span>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ------------------------------------------------------------- volumes

/** "local:iso/debian.iso" → "debian.iso". */
export function volumeName(volid: string): string {
  const v = volid.slice(volid.indexOf(':') + 1)
  return v.slice(v.lastIndexOf('/') + 1)
}

export interface VolumeSelectProps {
  node: string
  storage: string | undefined
  content: string
  value: string | undefined
  onValueChange: (v: string | undefined) => void
  filter?: (v: { volid: string; format?: string }) => boolean
  placeholder?: string
}

/** Volumes of one storage (ISO images, import sources, snippets…). */
export function VolumeSelect({ node, storage, content, value, onValueChange, filter, placeholder = '选择文件' }: VolumeSelectProps) {
  const { data, isPending, isError } = useStorageVolumes(node, storage, content)
  const options: SearchOption[] = (data ?? [])
    .filter((v) => !filter || filter(v))
    .sort((a, b) => a.volid.localeCompare(b.volid))
    .map((v) => ({
      value: v.volid,
      label: volumeName(v.volid),
      description: [v.format, v.size ? formatBytes(v.size) : null].filter(Boolean).join(' · '),
    }))
  if (value && !options.some((o) => o.value === value)) options.unshift({ value, label: volumeName(value), description: '当前' })
  return (
    <SearchSelect
      value={value}
      onValueChange={onValueChange}
      options={options}
      loading={!!storage && isPending}
      disabled={!storage}
      placeholder={!storage ? '先选择存储' : isError ? '无法加载内容' : options.length === 0 ? '这个存储里没有可用文件' : placeholder}
      searchPlaceholder="搜索文件名…"
    />
  )
}

// ----------------------------------------------------------- disk target

export interface DiskTarget {
  storage: string | undefined
  format: string | undefined
  /** GiB */
  size: number | undefined
}

function storageOption(s: NodeStorageWithFormats): SelectOption {
  return {
    value: s.storage,
    label: s.storage,
    description:
      s.avail !== undefined && s.total ? `${s.type} · 可用 ${formatBytes(s.avail)} / ${formatBytes(s.total)}` : s.type,
    disabled: s.active === 0,
  }
}

/** Formats a storage can hold (raw/qcow2/vmdk), and the preselected one. */
export function storageFormats(s: NodeStorageWithFormats | undefined): { formats: string[]; preferred: string } {
  const supported = (s?.formats?.supported ?? ['raw']).filter((f) => f !== 'subvol')
  const preferred = supported.includes('qcow2') ? 'qcow2' : supported.includes('raw') ? 'raw' : (s?.formats?.default ?? 'raw')
  return { formats: supported, preferred }
}

/**
 * Storage (+ size + format) for a new volume. Storages that support more
 * than one format show a format choice, like the official DiskStorageSelector.
 */
export function DiskTargetFields({
  node,
  value,
  onChange,
  hideSize,
  storageLabel = '存储',
  sizeLabel = '大小',
  content = 'images',
}: {
  node: string
  value: DiskTarget
  onChange: (v: DiskTarget) => void
  hideSize?: boolean
  storageLabel?: string
  sizeLabel?: string
  content?: string
}) {
  const { data, isPending, isError } = useStorageFormats(node, content)
  const storages = useMemo(() => (data ?? []).filter((s) => s.active !== 0).sort((a, b) => a.storage.localeCompare(b.storage)), [data])
  const current = storages.find((s) => s.storage === value.storage)
  const { formats, preferred } = storageFormats(current)

  // Preselect the first storage by name (as the official selector does), then its preferred format.
  useEffect(() => {
    if (!value.storage && storages.length) {
      const first = storages[0]!
      onChange({ ...value, storage: first.storage, format: storageFormats(first).preferred })
    }
  }, [storages, value, onChange])

  const storageField = (
    <FormField label={storageLabel} name="storage" required>
      <SelectField
        value={value.storage}
        onValueChange={(storage) => {
          const s = storages.find((x) => x.storage === storage)
          onChange({ ...value, storage, format: storageFormats(s).preferred })
        }}
        options={storages.map(storageOption)}
        loading={isPending}
        placeholder={isError ? '无法加载存储' : storages.length === 0 && !isPending ? '没有可存放磁盘的存储' : '选择存储'}
      />
    </FormField>
  )
  const formatField =
    formats.length > 1 ? (
      <FormField label="格式" name="format">
        <SelectField
          value={value.format ?? preferred}
          onValueChange={(format) => onChange({ ...value, format })}
          options={formats.map((f) => ({ value: f, label: DISK_FORMAT_LABEL[f] ?? f }))}
        />
      </FormField>
    ) : null

  if (hideSize) {
    return (
      <>
        {storageField}
        {formatField}
      </>
    )
  }
  return (
    <>
      <FormRow>
        {storageField}
        <FormField label={sizeLabel} name="size" required>
          <NumberInput
            value={value.size}
            onChange={(size) => onChange({ ...value, size })}
            min={0.001}
            max={128 * 1024}
            decimal
            unit="GiB"
          />
        </FormField>
      </FormRow>
      {formatField}
    </>
  )
}

// ------------------------------------------------------------- bus/slot

export function BusSlotFields({
  buses,
  bus,
  index,
  onChange,
  taken,
  label = '总线 / 设备',
  extra,
}: {
  buses: readonly string[]
  bus: string
  index: number | undefined
  onChange: (bus: string, index: number | undefined) => void
  /** Is "<bus><index>" already used? */
  taken: (key: string) => boolean
  label?: string
  extra?: ReactNode
}) {
  const max = (BUS_MAX[bus] ?? 1) - 1
  const conflict = index !== undefined && taken(`${bus}${index}`)
  return (
    <FormField label={label} error={conflict ? `${bus}${index} 已被占用` : undefined} hint={extra}>
      <div className="flex gap-2">
        <SelectField
          aria-label="总线"
          className="flex-[3]"
          value={bus}
          onValueChange={(b) => {
            if (!b) return
            let i = 0
            while (i < (BUS_MAX[b] ?? 1) && taken(`${b}${i}`)) i++
            onChange(b, i < (BUS_MAX[b] ?? 1) ? i : 0)
          }}
          options={buses.map((b) => ({ value: b, label: BUS_LABEL[b] ?? b }))}
        />
        <div className="flex-[2]">
          <NumberInput aria-label="设备编号" value={index} onChange={(i) => onChange(bus, i)} min={0} max={max} />
        </div>
      </div>
    </FormField>
  )
}
