import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

// A PR body is someone else's HTML: nothing that could restyle the app, draw over it or post a form.
// Task-list checkboxes (input type=checkbox) stay; they're disabled by marked.
const PURIFY = {
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'dialog', 'template', 'link', 'meta'],
  FORBID_ATTR: ['style', 'popover', 'popovertarget', 'popovertargetaction', 'formaction', 'form']
}

// Of inputs, only (disabled) task-list checkboxes survive.
DOMPurify.addHook('uponSanitizeElement', (node, data) => {
  if (data.tagName !== 'input' || !(node instanceof HTMLInputElement)) return
  if (node.type !== 'checkbox') node.remove()
  else node.disabled = true
})

/** One line of Markdown (bold, code, links) as sanitized HTML, for lists like What's New. */
export function inlineMarkdown(text: string): string {
  return DOMPurify.sanitize(marked.parseInline(text, { gfm: true, async: false }) as string, PURIFY)
}

/** GitHub-flavored Markdown from PR descriptions and comments, sanitized; links open in the browser. */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: true, async: false }) as string, PURIFY),
    [text]
  )
  if (!text.trim()) return <p className={`md muted ${className}`}>No description provided.</p>
  return (
    <div
      className={`md ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={(e) => {
        const a = (e.target as HTMLElement).closest('a')
        if (!a) return
        e.preventDefault()
        if (a.href.startsWith('https://')) window.spoon.openExternal(a.href)
      }}
    />
  )
}
