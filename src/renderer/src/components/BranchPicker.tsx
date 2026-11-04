// A branch field: type to search the repository's branches and tags, or name any other branch, tag
// or commit by hand. The list opens below it (above any dialog, so it isn't cut off).
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Ref } from '../../../shared/types'
import { BranchIcon, CheckIcon, ChevronIcon, CloudIcon, TagIcon } from './Icons'
import { shortRef } from '../compare'

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

  // The value is a full ref name (refs/heads/…, so a tag with a branch's name is never taken for it) or
  // whatever was typed; the field shows refs by their short name.
  const shownValue = refs.find((r) => r.fullName === value)?.name ?? shortRef(value)

  const items = useMemo<Item[]>(() => {
    if (!open) return []
    const words = typed ? query.toLowerCase().split(/\s+/).filter(Boolean) : []
    const q = words.join(' ')
    // Every word somewhere in the name; the exact name first (its group leading), then names that
    // start with what's typed (or whose last part does).
    const rank = (name: string): number => {
      const n = name.toLowerCase()
      return n === q ? 0 : n.startsWith(q) || n.slice(n.lastIndexOf('/') + 1).startsWith(q) ? 1 : 2
    }
    const found = refs.filter((r) => r.kind !== 'stash' && words.every((w) => r.name.toLowerCase().includes(w)))
    const best = (kind: string): number => Math.min(3, ...found.filter((r) => r.kind === kind).map((r) => (q ? rank(r.name) : 3)))
    const groups = GROUPS.map(([kind], i) => ({ kind, i })).sort((x, y) => best(x.kind) - best(y.kind) || x.i - y.i)
    const out: Item[] = []
    for (const { kind } of groups)
      out.push(
        ...found
          .filter((r) => r.kind === kind)
          .sort((a, b) => (q ? rank(a.name) - rank(b.name) : 0))
          .map((ref) => ({ kind: 'ref' as const, ref }))
      )
    const shown = out.slice(0, MAX_SHOWN)
    // Anything else typed (a commit, a ref the list doesn't have) can be used as it is: first when it
    // looks like a commit id.
    const name = query.trim()
    if (typed && name && !refs.some((r) => r.name === name || r.fullName === name)) {
      if (/^[0-9a-f]{4,40}$/i.test(name)) shown.unshift({ kind: 'typed', name })
      else shown.push({ kind: 'typed', name })
    }
    return shown
  }, [open, query, typed, refs])

  const begin = (): void => {
    setQuery(shownValue)
    setTyped(false)
    setBox(input.current?.getBoundingClientRect() ?? null)
    const i = refs.filter((r) => r.kind !== 'stash')
    setAt(Math.max(0, GROUPS.flatMap(([k]) => i.filter((r) => r.kind === k)).findIndex((r) => r.fullName === value)))
    requestAnimationFrame(() => input.current?.select())
  }
  const close = (): void => setQuery(null)
  // Set while a pick closes the field, so leaving it doesn't also take what was typed.
  const picking = useRef(false)
  const pick = (name: string): void => {
    picking.current = true
    close()
    input.current?.blur()
    picking.current = false
    if (name && name !== value) onChange(name)
  }
  /** What typed text means: a listed ref (by its full name), or itself. */
  const resolve = (text: string): string => refs.find((r) => r.name === text || r.fullName === text)?.fullName ?? text
  const nameOf = (item: Item): string => (item.kind === 'ref' ? item.ref.fullName : item.name)

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
      const text = (query ?? '').trim()
      // An emptied field keeps what it had.
      if (typed && !text) return pick(value)
      const item = items[at]
      pick(item ? nameOf(item) : resolve(text))
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
        value={open ? query : shownValue}
        title={title}
        aria-label={title}
        spellCheck={false}
        data-own-enter
        placeholder="Search branches"
        onFocus={begin}
        onBlur={() => {
          // Typed and left (Tab, or a click on Compare): what was typed counts.
          const text = (query ?? '').trim()
          if (!picking.current && typed && text && text !== shownValue) {
            close()
            onChange(resolve(text))
          } else close()
        }}
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
              const label = item.kind === 'ref' ? item.ref.name : item.name
              return (
                <div key={item.kind === 'ref' ? item.ref.fullName : `typed:${name}`}>
                  {header && <div className="pl-group">{header}</div>}
                  <div
                    className={`pl-item ${i === at ? 'on' : ''}`}
                    role="option"
                    aria-selected={i === at}
                    onMouseEnter={() => setAt(i)}
                    onClick={() => pick(name)}
                    title={label}
                  >
                    {item.kind === 'ref' ? icon(item.ref) : <span className="icon" />}
                    <span className="pl-name">{item.kind === 'ref' ? label : <>Use “{label}”</>}</span>
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
