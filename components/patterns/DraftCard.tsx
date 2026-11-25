import { ResourceLink } from '@/components/ui/ResourceLink'
import { Button } from '@/components/ui/Button'

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export interface DraftCardProps {
  id: string
  title: string
  platform: string
  rubrics: { id: string; title: string }[]
  savedAt: string
  onContinue: () => void
  onDelete?: () => void
  deleteDisabled?: boolean
}

export function DraftCard({
  id,
  title,
  platform,
  rubrics,
  savedAt,
  onContinue,
  onDelete,
  deleteDisabled,
}: DraftCardProps) {
  const savedDate = new Date(savedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-card)] px-5 py-4">
      <div className="flex items-start justify-between gap-4">

        {/* Left column */}
        <div className="flex-1 min-w-0">

          {/* Row 1: rubric tags */}
          {rubrics.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              {rubrics.map(r => (
                <span
                  key={r.id}
                  className="inline-flex items-center px-2 py-0.5 rounded-sm bg-[var(--color-surface-container)] text-[var(--color-text-secondary)] text-label-sm font-label font-medium"
                >
                  {r.title}
                </span>
              ))}
            </div>
          )}

          {/* Row 2: title */}
          <h2 className="font-heading text-title-md text-text-primary leading-snug truncate">
            {title}
          </h2>

          {/* Row 3: platform + saved date */}
          <div className={cx(
            'flex items-center gap-4 text-body-sm text-text-secondary flex-wrap',
            rubrics.length > 0 ? 'mt-1.5' : 'mt-2',
          )}>
            <ResourceLink documentId={id} label={platform} />
            <span className="flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="12" height="10" rx="1" />
                <path d="M2 8h12M6 2v4M10 2v4" />
              </svg>
              Saved: {savedDate}
            </span>
          </div>

        </div>

        {/* Right column — actions */}
        <div className="shrink-0 flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={onContinue}>
            Continue
          </Button>
          {(onDelete || deleteDisabled) && (
            <Button
              variant="destructive"
              size="sm"
              onClick={onDelete}
              disabled={deleteDisabled}
            >
              Delete
            </Button>
          )}
        </div>

      </div>
    </div>
  )
}
