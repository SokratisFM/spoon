// A branch field: type to search the repository's branches and tags, or name any other branch, tag
// or commit by hand. The list opens below it (above any dialog, so it isn't cut off).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Ref } from '../../../shared/types'
import { BranchIcon, CheckIcon, ChevronIcon, CloudIcon, TagIcon } from './Icons'

/** Results shown at most; typing narrows them down. */
const MAX_SHOWN = 300

const GROUPS = [
  ['head', 'Branches'],
  ['remote', 'Remote branches'],
  ['tag', 'Tags']
] as const

interface Props {
  refs: Ref[]
  value: string
  onChange: (value: string) => void
  title?: string
  className?: string
}

type Item = { kind: 'ref'; ref: Ref } | { kind: 'typed'; name: string }

export function BranchPicker({ refs, value, onChange, title, className }: Props) {
  // null while closed; otherwise what's in the field, and whether it was typed (else everything shows).
  const [query, setQuery] = useState<string | null>(null)
  const [typed, setTyped] = useState(false)
  const [at, setAt] = useState(0)
  const [box, setBox] = useState<DOMRect | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const open = query !== null

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const words = typed ? query.toLowerCase().split(/\s+/).filter(Boolean) : []
    const q = words.join(' ')
    // Every word somewhere in the name; names that start with what's typed (or whose last part does) first.
    const rank = (name: string): number => {
      const n = name.toLowerCase()
      return n === q ? 0 : n.startsWith(q) || n.slice(n.lastIndexOf('/') + 1).startsWith(q) ? 1 : 2
    }
    const found = refs.filter((r) => r.kind !== 'stash' && words.every((w) => r.name.toLowerCase().includes(w)))
    const out: Item[] = []
    for (const [kind] of GROUPS)
      out.push(
        ...found
          .filter((r) => r.kind === kind)
          .sort((a, b) => (q ? rank(a.name) - rank(b.name) : 0))
          .map((ref) => ({ kind: 'ref' as const, ref }))
      )
    const shown = out.slice(0, MAX_SHOWN)
    // Anything else typed (a commit, a ref the list doesn't have) can be used as it is.
    const name = query.trim()
    if (typed && name && !refs.some((r) => r.name === name)) shown.push({ kind: 'typed', name })
    return shown
  }, [open, query, typed, refs])

  const begin = (): void => {
    setQuery(value)
    setTyped(false)
    setBox(input.current?.getBoundingClientRect() ?? null)
    const i = refs.filter((r) => r.kind !== 'stash')
    setAt(Math.max(0, GROUPS.flatMap(([k]) => i.filter((r) => r.kind === k)).findIndex((r) => r.name === value)))
    requestAnimationFrame(() => input.current?.select())
  }
  const close = (): void => setQuery(null)
  const pick = (name: string): void => {
    close()
    input.current?.blur()
    if (name && name !== value) onChange(name)
  }
  const nameOf = (item: Item): string => (item.kind === 'ref' ? item.ref.name : item.name)

  useEffect(() => {
    list.current?.querySelector('.pl-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [at, open])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') begin()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setAt((i) => Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = items[at]
      pick(item ? nameOf(item) : (query ?? '').trim())
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
      input.current?.blur()
    }
  }

  const icon = (r: Ref) =>
    r.kind === 'tag' ? <TagIcon className="icon" /> : r.kind === 'remote' ? <CloudIcon className="icon" /> : <BranchIcon className="icon" />
  let group: string | null = null
  const below = box ? window.innerHeight - box.bottom - 16 : 0
  const up = !!box && below < 200 && box.top > below

  return (
    <span className={`branch-picker ${className ?? ''}`}>
      <input
        ref={input}
        value={open ? query : value}
        title={title}
        aria-label={title}
        spellCheck={false}
        data-own-enter
        placeholder="Search branches"
        onFocus={begin}
        onBlur={close}
        onMouseDown={() => {
          if (!open && document.activeElement === input.current) begin()
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          setTyped(true)
          setAt(0)
        }}
        onKeyDown={onKeyDown}
      />
      <ChevronIcon className="icon bp-chevron" />
      {open &&
        box &&
        createPortal(
          <div
            ref={list}
            className="popup-list"
            role="listbox"
            style={{
              left: box.left,
              width: Math.max(box.width, 260),
              ...(up ? { bottom: window.innerHeight - box.top + 4, maxHeight: Math.min(360, box.top - 16) } : { top: box.bottom + 4, maxHeight: Math.min(360, below) })
            }}
            // Clicks in the list mustn't take focus from the field (which would close it first).
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.length === 0 && <div className="pl-empty muted">No branches match.</div>}
            {items.map((item, i) => {
              const kind = item.kind === 'ref' ? item.ref.kind : 'typed'
              const header = kind !== group && kind !== 'typed' ? GROUPS.find(([k]) => k === kind)?.[1] : null
              group = kind
              const name = nameOf(item)
              return (
                <div key={item.kind === 'ref' ? item.ref.fullName : `typed:${name}`}>
                  {header && <div className="pl-group">{header}</div>}
                  <div
                    className={`pl-item ${i === at ? 'on' : ''}`}
                    role="option"
                    aria-selected={i === at}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => pick(name)}
                    title={name}
                  >
                    {item.kind === 'ref' ? icon(item.ref) : <span className="icon" />}
                    <span className="pl-name">{item.kind === 'ref' ? name : <>Use “{name}”</>}</span>
                    {name === value && <CheckIcon className="icon pl-check" />}
                  </div>
                </div>
              )
            })}
          </div>,
          document.body
        )}
    </span>
  )
}
