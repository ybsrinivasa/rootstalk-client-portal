'use client'
import React from 'react'

/**
 * Minimal Markdown renderer for Decision Report section bodies.
 *
 * The engine emits a known subset — headings, bold, italic, bullet
 * lists, pipe tables, inline code — so we parse that subset here
 * instead of pulling in a markdown library. Anything outside the
 * subset renders as plain text (safe default).
 *
 * Covered:
 *   `## heading`                → h2
 *   `### subheading`            → h3
 *   `**bold**`                  → <strong>
 *   `_italic_`                  → <em>
 *   `` `code` ``                → <code>
 *   `- list item`               → <ul><li>
 *   `| col | col |` + separator → <table>
 *   blank line                  → paragraph break
 */
export default function ReportMarkdown({ body }: { body: string }) {
  const blocks = parseBlocks(body)
  return (
    <div className="prose-sm max-w-none">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

type Block =
  | { kind: 'h2'; text: string }
  | { kind: 'h3'; text: string }
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; headers: string[]; rows: string[][] }

function parseBlocks(src: string): Block[] {
  const lines = src.split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }

    if (line.startsWith('## ')) {
      blocks.push({ kind: 'h2', text: line.slice(3) })
      i++
      continue
    }
    if (line.startsWith('### ')) {
      blocks.push({ kind: 'h3', text: line.slice(4) })
      i++
      continue
    }
    if (line.startsWith('- ')) {
      const items: string[] = []
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2))
        i++
      }
      blocks.push({ kind: 'ul', items })
      continue
    }
    // Pipe table: header row + separator row + body rows. Separator
    // is `| --- | --- |` etc.
    if (line.startsWith('|') && i + 1 < lines.length && /^\|[-:| ]+\|$/.test(lines[i + 1].trim())) {
      const headers = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', headers, rows })
      continue
    }
    // Default — paragraph collects consecutive non-empty lines.
    const buf: string[] = []
    while (i < lines.length
      && lines[i].trim()
      && !lines[i].startsWith('## ')
      && !lines[i].startsWith('### ')
      && !lines[i].startsWith('- ')
      && !lines[i].startsWith('|')) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ kind: 'p', text: buf.join(' ') })
  }
  return blocks
}

function splitRow(line: string): string[] {
  const parts = line.split('|')
  // Drop the empty leading/trailing cells from `|a|b|`.
  if (parts[0] === '') parts.shift()
  if (parts.length && parts[parts.length - 1].trim() === '') parts.pop()
  return parts.map(p => p.trim())
}

function renderBlock(b: Block, key: number): React.ReactNode {
  if (b.kind === 'h2') {
    return <h2 key={key} className="text-base font-semibold text-slate-800 mt-4 mb-2">{renderInline(b.text)}</h2>
  }
  if (b.kind === 'h3') {
    return <h3 key={key} className="text-sm font-semibold text-slate-700 mt-3 mb-1">{renderInline(b.text)}</h3>
  }
  if (b.kind === 'ul') {
    return (
      <ul key={key} className="list-disc pl-5 space-y-0.5 text-sm text-slate-700 my-2">
        {b.items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
      </ul>
    )
  }
  if (b.kind === 'table') {
    return (
      <div key={key} className="my-2 overflow-x-auto">
        <table className="min-w-full text-xs border border-slate-200 rounded">
          <thead className="bg-slate-50">
            <tr>{b.headers.map((h, j) => (
              <th key={j} className="px-2 py-1.5 text-left font-medium text-slate-600 border-b border-slate-200">
                {renderInline(h)}
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, j) => (
              <tr key={j} className="border-b border-slate-100 last:border-0">
                {r.map((c, k) => (
                  <td key={k} className="px-2 py-1 text-slate-700">{renderInline(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <p key={key} className="text-sm text-slate-700 my-2">{renderInline(b.text)}</p>
}

function renderInline(text: string): React.ReactNode[] {
  // Tokenize **bold**, _italic_, `code`. Simple non-overlapping scan.
  const out: React.ReactNode[] = []
  const pattern = /\*\*([^*]+)\*\*|_([^_]+)_|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined) out.push(<strong key={key++}>{m[1]}</strong>)
    else if (m[2] !== undefined) out.push(<em key={key++}>{m[2]}</em>)
    else if (m[3] !== undefined) out.push(<code key={key++} className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded">{m[3]}</code>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}
