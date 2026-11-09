'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Checkbox'
import type { OerToc } from '@/lib/oer-toc'

interface ChapterPickerProps {
  /** The URL the author typed (any page of the book). */
  url: string
  /** Called with every page URL of the picked chapters, in book order. */
  onAdd: (pageUrls: string[]) => void
  disabled?: boolean
}

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

/** Load a book's table of contents and let the author add whole chapters at once. */
export function ChapterPicker({ url, onAdd, disabled }: ChapterPickerProps) {
  const [toc, setToc] = useState<OerToc | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    setToc(null)
    setSelected(new Set())
    setExpanded(new Set())
    try {
      const res = await fetch(`/api/oer-toc?url=${encodeURIComponent(url.trim())}`)
      const body = await res.json()
      if (!res.ok) setError(body.error ?? "Couldn't load chapters.")
      else setToc(body as OerToc)
    } catch {
      setError("Couldn't load chapters. Check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }

  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    return next
  }

  const pickedPages = toc ? [...selected].sort((a, b) => a - b).flatMap(i => toc.chapters[i].pages) : []

  function add() {
    if (!pickedPages.length) return
    onAdd(pickedPages.map(p => p.url))
    setToc(null)
    setSelected(new Set())
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" onClick={load} loading={loading} disabled={disabled || !url.trim()}>
          Load chapters
        </Button>
        <span className="text-body-sm text-text-secondary">
          Submitting a whole chapter? Paste any page from the book, then load its chapters.
        </span>
      </div>

      {error && <p className="text-body-sm text-error">{error}</p>}

      {toc && (
        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-label-md text-text-primary">
              {toc.bookTitle}
              <span className="text-text-secondary"> · {toc.platform}</span>
            </span>
            <span className="text-body-sm text-text-secondary">Select chapters to review</span>
          </div>

          <ul className="max-h-72 overflow-y-auto">
            {toc.chapters.map((chapter, i) => (
              <li key={i} className={cx('border-b border-border last:border-b-0', selected.has(i) && 'bg-surface-container')}>
                <div className="flex items-center gap-3 px-3 py-2">
                  <label className="flex flex-1 min-w-0 cursor-pointer items-center gap-3">
                    <Checkbox
                      checked={selected.has(i)}
                      onChange={() => setSelected(s => toggle(s, i))}
                      aria-label={`Select ${chapter.title}`}
                    />
                    <span className="truncate text-body-md text-text-primary">{chapter.title}</span>
                  </label>
                  <span className="shrink-0 text-body-sm text-text-secondary">
                    {chapter.pages.length} page{chapter.pages.length === 1 ? '' : 's'}
                  </span>
                  {chapter.pages.length > 1 && (
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() => setExpanded(s => toggle(s, i))}
                      aria-expanded={expanded.has(i)}
                    >
                      {expanded.has(i) ? 'Hide pages' : 'Show pages'}
                    </Button>
                  )}
                </div>
                {expanded.has(i) && (
                  <p className="px-3 pb-2 pl-11 text-body-sm text-text-secondary">
                    {chapter.pages.map(p => p.title).join(' · ')}
                  </p>
                )}
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-2">
            <span className="text-body-sm text-text-secondary">
              {selected.size
                ? `${selected.size} selected · ${pickedPages.length} page${pickedPages.length === 1 ? '' : 's'} will be added`
                : 'No chapters selected'}
            </span>
            <Button variant="primary" size="sm" onClick={add} disabled={!selected.size}>
              Add to submission
            </Button>
          </div>
          <p className="border-t border-border px-3 py-2 text-body-sm text-text-secondary">
            Pages are added to the list below. You can still remove any page before submitting.
          </p>
        </div>
      )}
    </div>
  )
}

export default ChapterPicker
