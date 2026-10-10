import { Fragment, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

/**
 * The assistant answers in Markdown -- **bold** button names, numbered steps.
 * Shown as plain text the asterisks were left in the answer for the studio to
 * read around. This draws the little Markdown it uses: paragraphs, numbered
 * and bulleted lists, **bold**, *italic*, `code` and [links](/path).
 *
 * Built from React elements, never HTML, so nothing a model writes can run.
 */
export function RichText({ text }: { text: string }) {
  const blocks = toBlocks(tidy(text))
  return (
    <div className="flex flex-col gap-2">
      {blocks.map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>{inline(b.lines.join('\n'))}</p>
        ) : b.kind === 'ol' ? (
          <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5 marker:font-semibold marker:text-muted-foreground">
            {b.lines.map((l, j) => (
              <li key={j} className="pl-0.5">
                {inline(l)}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted-foreground">
            {b.lines.map((l, j) => (
              <li key={j} className="pl-0.5">
                {inline(l)}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  )
}

/** Internal page addresses ("(screen/employees)", "(/employees)") mean nothing to a studio. */
export function tidy(text: string): string {
  return text
    .replace(/\s*\((?:screen\/|\/)[a-z0-9_/-]+\)/gi, '')
    .replace(/\r\n/g, '\n')
    .trim()
}

type Block = { kind: 'p' | 'ol' | 'ul'; lines: string[] }

export function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/)
    const ul = line.match(/^\s*[-*•]\s+(.*)$/)
    const kind: Block['kind'] | null = ol ? 'ol' : ul ? 'ul' : line.trim() ? 'p' : null
    if (!kind) {
      blocks.push({ kind: 'p', lines: [] }) // a blank line ends the paragraph
      continue
    }
    const content = ol?.[1] ?? ul?.[1] ?? line.trim()
    const last = blocks[blocks.length - 1]
    if (last && last.kind === kind && (kind !== 'p' || last.lines.length > 0)) last.lines.push(content)
    else blocks.push({ kind, lines: [content] })
  }
  return blocks.filter((b) => b.lines.length > 0)
}

const TOKEN = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

/** **bold**, *italic*, `code` and [links](...) inside one line or paragraph. */
function inline(text: string): ReactNode {
  const parts = text.split(TOKEN)
  return parts.map((part, i) => {
    if (!part) return null
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      )
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)
    if (link) {
      const [, label, href] = link
      if (href!.startsWith('/') && !href!.startsWith('//')) {
        return (
          <Link key={i} to={href as never} className="font-medium text-primary underline-offset-4 hover:underline">
            {label}
          </Link>
        )
      }
      if (/^https?:\/\//.test(href!)) {
        return (
          <a key={i} href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline-offset-4 hover:underline">
            {label}
          </a>
        )
      }
      return <Fragment key={i}>{label}</Fragment>
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={i}>{part.slice(1, -1)}</em>
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
