'use client'

interface ResourceLinkProps {
  documentId: string
  label: string
  className?: string
}

export function ResourceLink({ documentId, label, className = '' }: ResourceLinkProps) {
  return (
    <a
      href={`/api/documents/${encodeURIComponent(documentId)}/resource`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${label} (opens in a new tab)`}
      onClick={e => e.stopPropagation()}
      className={`inline-flex items-center gap-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-sm ${className}`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5 shrink-0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M9 2h5v5M14 2L7 9" />
      </svg>
      {label}
    </a>
  )
}
