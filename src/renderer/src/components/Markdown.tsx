import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

/** GitHub-flavored Markdown from PR descriptions and comments, sanitized; links open in the browser. */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text || '', { gfm: true, breaks: true, async: false }) as string),
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
