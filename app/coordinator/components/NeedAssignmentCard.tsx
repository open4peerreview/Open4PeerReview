'use client'

import { ResourceLink } from '@/components/ui/ResourceLink'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RubricTag } from '@/components/ui/RubricTag'
import { Button } from '@/components/ui/Button'
import { assignAndReleaseDocument } from '../actions'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

const FILE_TYPE_LABEL: Record<string, string> = {
  pdf: 'PDF', html: 'HTML', image: 'Image', audio: 'Audio',
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

interface OrgReviewer {
  id: string
  display_name: string | null
  email: string
}

export interface NeedAssignmentCardProps {
  doc: {
    id: string
    title: string
    file_type: string | null
    created_at: string
    submission_scope?: string[] | null
    author: { id: string; display_name: string | null; email: string } | null
    document_rubrics: { rubric: { id: string; title: string } | null }[]
  }
  orgReviewers: OrgReviewer[]
  preAssigned?: OrgReviewer[]
}

export function NeedAssignmentCard({ doc, orgReviewers, preAssigned = [] }: NeedAssignmentCardProps) {
  const eligibleReviewers = orgReviewers.filter(r => r.id !== doc.author?.id)
  const router = useRouter()
  const [showAssign, setShowAssign] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const rubrics = doc.document_rubrics.map(dr => dr.rubric).filter(Boolean) as { id: string; title: string }[]
  const fileTypeLabel = FILE_TYPE_LABEL[doc.file_type ?? ''] ?? doc.file_type
  const scope = (doc.submission_scope ?? []) as string[]

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleRelease() {
    setError(null)
    startTransition(async () => {
      try {
        await assignAndReleaseDocument(doc.id, Array.from(selected))
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to release document.')
      }
    })
  }

  function handleCancel() {
    setShowAssign(false)
    setSelected(new Set())
    setError(null)
  }

  const releaseLabel = selected.size > 0
    ? `Assign ${selected.size} & Release`
    : 'Release without assignment'

  return (
    <div className="rounded-lg bg-[var(--color-surface-card)] border border-[var(--color-border)] shadow-[var(--shadow-1)] p-5">

      {/* Main content */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">

          {/* Row 1: format badge + public pill + author + date */}
          <div className="flex items-center gap-3 flex-wrap text-body-sm text-text-secondary">
            {fileTypeLabel && (
              <ResourceLink
                documentId={doc.id}
                label={fileTypeLabel}
                className="px-2 py-0.5 bg-[var(--color-surface-container-high)] text-label-sm font-label font-semibold uppercase tracking-widest text-text-secondary"
              />
            )}
            {scope.includes('public') && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm border border-[var(--color-border)] text-label-sm font-label font-semibold uppercase tracking-widest text-text-secondary">
                <svg viewBox="0 0 16 16" fill="none" className="w-3 h-3 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="8" cy="8" r="6"/>
                  <path d="M8 2a8.5 8.5 0 010 12M8 2a8.5 8.5 0 000 12M2 8h12"/>
                </svg>
                Public
              </span>
            )}
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 7a3 3 0 100-6 3 3 0 000 6zM2 14a6 6 0 0112 0" />
              </svg>
              {doc.author?.display_name ?? doc.author?.email ?? 'Unknown'}
            </span>
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="4" width="12" height="10" rx="1" />
                <path d="M2 8h12M6 2v4M10 2v4" />
              </svg>
              {formatDate(doc.created_at)}
            </span>
          </div>

          {/* Title */}
          <h4 className="font-heading text-title-md text-text-primary leading-snug mt-2">
            {doc.title}
          </h4>

          {/* Row 2: rubric tags */}
          {rubrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              {rubrics.map(r => (
                <RubricTag key={r.id} label={r.title} variant="outlined" />
              ))}
            </div>
          )}

          {/* Row 3: pre-assigned reviewer chips */}
          {preAssigned.length > 0 && (
            <div className="mt-2.5">
              <p className="text-label-sm font-label uppercase tracking-wide text-text-muted mb-1.5">
                Assigned reviewers
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preAssigned.map(r => (
                  <span
                    key={r.id}
                    className="inline-flex items-center px-2 py-0.5 rounded-sm bg-[var(--color-surface-container-high)] text-label-sm font-label text-text-secondary"
                  >
                    {r.display_name ?? r.email}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>

        {/* CTA — hidden while assign checklist is open */}
        {!showAssign && (
          <Button
            variant="primary"
            size="sm"
            className="shrink-0"
            disabled={isPending}
            onClick={() => setShowAssign(true)}
          >
            Assign &amp; Release
          </Button>
        )}
      </div>

      {/* Inline reviewer checklist */}
      {showAssign && (
        <div className="mt-4 pt-4 border-t border-[var(--color-border)] space-y-3">
          <p className="text-body-sm font-medium text-text-primary">
            Assign reviewers before releasing
          </p>

          {eligibleReviewers.length === 0 ? (
            <p className="text-body-sm text-text-muted italic">
              No reviewers in your organization yet.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
              {eligibleReviewers.map(r => (
                <label
                  key={r.id}
                  className={cx(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-all',
                    selected.has(r.id)
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/5'
                      : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                    isPending && 'opacity-60 cursor-default',
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-[var(--color-border)] accent-[var(--color-primary)]"
                    checked={selected.has(r.id)}
                    onChange={() => toggle(r.id)}
                    disabled={isPending}
                  />
                  <span>
                    <span className="block text-body-sm font-medium text-text-primary">
                      {r.display_name ?? 'Unnamed'}
                    </span>
                    <span className="block text-label-sm text-text-muted">{r.email}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          {error && (
            <p className="text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={handleCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleRelease}
              disabled={isPending}
              loading={isPending}
            >
              {releaseLabel}
            </Button>
          </div>
        </div>
      )}

    </div>
  )
}
