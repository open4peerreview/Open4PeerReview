'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { uploadDocument, assignRubrics, submitTorusLink, savePdfDraft, updateDraftMetadata } from '@/lib/supabase/queries'
import { EXPERT_DOMAIN_LABELS, CC_LICENSE_LABELS, CC_LICENSE_DESCRIPTIONS } from '@/types'
import type { ExpertDomain, CreativeCommonsLicense } from '@/types'
import { Modal, ModalContent } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { SelectionCard } from '@/components/ui/SelectionCard'
import { StepIndicator } from '@/components/ui/StepIndicator'
import { ConfirmationDialog } from '@/components/ui/ConfirmationDialog'
import { isValidOerUrl, isTorusUrl } from '@/lib/oer-platform'
import { mergeChapterPages } from '@/lib/oer-toc'
import { ChapterPicker } from '@/components/patterns/ChapterPicker'

type SourceTab = 'pdf' | 'openstax' | 'torus'

const STEPS = ['Resource', 'Rubrics', 'License', 'Visibility', 'Review']

const PREDEFINED_ENTRIES = (Object.entries(EXPERT_DOMAIN_LABELS) as [ExpertDomain, string][])
  .filter(([key]) => key !== 'other')

const OTHER_SENTINEL = 'other'

interface RubricOption {
  id: string
  title: string
  description: string | null
}

interface Props {
  isOpen: boolean
  onClose: () => void
  rubrics: RubricOption[]
  customSubjectMatters: string[]
  displayName: string
  authorInstitution?: string | null
  /** When provided, load this draft and pre-fill the wizard on open. */
  documentId?: string
}

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

export function SubmissionModal({
  isOpen,
  onClose,
  rubrics,
  customSubjectMatters,
  displayName,
  authorInstitution,
  documentId,
}: Props) {
  // Navigation state
  const [step, setStep] = useState(1)
  const [touched, setTouched] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  // Form state — preserve all existing variable names from UploadDocumentForm
  const [sourceTab, setSourceTab] = useState<SourceTab>('pdf')
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState(displayName)
  const [subjectMatter, setSubjectMatter] = useState('')
  const [customSubject, setCustomSubject] = useState('')
  const [ccLicense, setCcLicense] = useState<CreativeCommonsLicense | ''>('')
  const [thirdPartyDisclosure, setThirdPartyDisclosure] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [openstaxUrl, setOpenstaxUrl] = useState('')
  const [additionalPageUrls, setAdditionalPageUrls] = useState<string[]>([])
  const [torusUrl, setTorusUrl] = useState('')
  const [torusCourseAccessCode, setTorusCourseAccessCode] = useState('')
  const [submissionScope, setSubmissionScope] = useState<'organization' | 'public'>('organization')
  const [publicReview, setPublicReview] = useState<boolean | null>(null)
  const [selectedRubrics, setSelectedRubrics] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [rubricError, setRubricError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Tracks the doc ID of a draft saved this wizard session so re-saves update rather than insert.
  const [draftDocumentId, setDraftDocumentId] = useState<string | null>(null)

  const fileRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  const isOther = subjectMatter === OTHER_SENTINEL
  const finalSubjectMatter = isOther ? customSubject.trim() : subjectMatter

  function touch() {
    if (!touched) setTouched(true)
  }

  function addPageUrl() { setAdditionalPageUrls(prev => [...prev, '']) }
  function removePageUrl(index: number) { setAdditionalPageUrls(prev => prev.filter((_, i) => i !== index)) }
  function updatePageUrl(index: number, value: string) { setAdditionalPageUrls(prev => prev.map((u, i) => i === index ? value : u)) }

  function resetAll() {
    setStep(1)
    setTouched(false)
    setSourceTab('pdf')
    setTitle('')
    setAuthors(displayName)
    setSubjectMatter('')
    setCustomSubject('')
    setCcLicense('')
    setThirdPartyDisclosure('')
    setFile(null)
    setOpenstaxUrl('')
    setAdditionalPageUrls([])
    setTorusUrl('')
    setTorusCourseAccessCode('')
    setSubmissionScope('organization')
    setPublicReview(null)
    setSelectedRubrics(new Set())
    setError(null)
    setRubricError(null)
    setLoading(false)
    setDraftDocumentId(null)
  }

  // Pre-fill wizard state when reopening an existing draft
  useEffect(() => {
    if (!isOpen || !documentId) return
    const draftId = documentId
    async function loadDraft() {
      const { data: doc } = await supabase
        .from('documents')
        .select('*, document_rubrics(rubric:rubrics(id, title))')
        .eq('id', draftId)
        .single()
      if (!doc) return

      setTouched(false)
      setTitle(doc.title ?? '')
      setAuthors(doc.authors ?? '')
      setThirdPartyDisclosure(doc.third_party_content_disclosure ?? '')
      setCcLicense((doc.creative_commons_license as CreativeCommonsLicense | '') ?? '')
      setSubmissionScope((doc.submission_scope?.[0] as 'organization' | 'public') ?? 'organization')
      setPublicReview(doc.public_review ?? null)
      setDraftDocumentId(draftId)

      const predefinedKeys = PREDEFINED_ENTRIES.map(([key]) => key as string)
      if (predefinedKeys.includes(doc.subject_matter ?? '')) {
        setSubjectMatter(doc.subject_matter ?? '')
        setCustomSubject('')
      } else {
        setSubjectMatter(OTHER_SENTINEL)
        setCustomSubject(doc.subject_matter ?? '')
      }

      const rubricIds = (doc.document_rubrics ?? [])
        .map((dr: { rubric: { id: string } | null }) => dr.rubric?.id)
        .filter((id: string | undefined): id is string => !!id)
      setSelectedRubrics(new Set(rubricIds))

      if (doc.file_type === 'pdf') {
        setSourceTab('pdf')
        setFile(null)
        setStep(1)
      } else if (doc.platform === 'OLI Torus') {
        setSourceTab('torus')
        setTorusUrl(doc.source_url ?? '')
        setTorusCourseAccessCode((doc as { course_access_code?: string | null }).course_access_code ?? '')
        setStep(rubricIds.length === 0 ? 2 : !doc.creative_commons_license ? 3 : 5)
      } else {
        setSourceTab('openstax')
        setOpenstaxUrl(doc.source_url ?? doc.file_url ?? '')
        setStep(rubricIds.length === 0 ? 2 : !doc.creative_commons_license ? 3 : 5)
      }
    }
    loadDraft()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, documentId])

  function handleCloseAttempt() {
    if (touched) {
      setShowConfirmDialog(true)
    } else {
      onClose()
    }
  }

  const handleSaveAsDraft = async () => {
    setLoading(true)
    setError(null)
    try {
      const rubricIds = Array.from(selectedRubrics)
      const sharedMeta = {
        title: title.trim() || 'Untitled Draft',
        authors: authors.trim(),
        subjectMatter: finalSubjectMatter || '',
        ccLicense: (ccLicense || 'cc_by') as CreativeCommonsLicense,
        thirdPartyDisclosure: thirdPartyDisclosure.trim() || null,
        submissionScope: [submissionScope] as string[],
        publicReview: publicReview ?? false,
      }

      if (sourceTab === 'pdf') {
        if (draftDocumentId) {
          await updateDraftMetadata(supabase, draftDocumentId, sharedMeta)
          await assignRubrics(supabase, draftDocumentId, rubricIds)
        } else {
          const doc = await savePdfDraft(supabase, { ...sharedMeta, rubricIds })
          setDraftDocumentId(doc.id)
        }
      } else if (sourceTab === 'torus') {
        if (draftDocumentId) {
          await updateDraftMetadata(supabase, draftDocumentId, {
            ...sharedMeta,
            sourceUrl: torusUrl.trim() || null,
            courseAccessCode: torusCourseAccessCode.trim() || null,
          })
          await assignRubrics(supabase, draftDocumentId, rubricIds)
        } else {
          const doc = await submitTorusLink(supabase, {
            url: torusUrl.trim(),
            title: sharedMeta.title,
            authors: sharedMeta.authors,
            subjectMatter: sharedMeta.subjectMatter,
            ccLicense: sharedMeta.ccLicense,
            thirdPartyDisclosure: sharedMeta.thirdPartyDisclosure,
            courseAccessCode: torusCourseAccessCode.trim() || null,
            rubricIds,
            submissionScope: sharedMeta.submissionScope,
            isDraft: true,
            coordinatorUpload: false,
            publicReview: sharedMeta.publicReview,
          })
          setDraftDocumentId(doc.id)
        }
      } else {
        // OpenStax — snapshot runs on each save; use documentId param to update existing row
        const body: Record<string, unknown> = {
          url: openstaxUrl.trim(),
          title: sharedMeta.title,
          authors: sharedMeta.authors,
          subjectMatter: sharedMeta.subjectMatter,
          ccLicense: sharedMeta.ccLicense,
          thirdPartyDisclosure: sharedMeta.thirdPartyDisclosure || undefined,
          rubricIds,
          submissionScope: sharedMeta.submissionScope,
          isDraft: true,
          publicReview: sharedMeta.publicReview,
          additionalPageUrls: additionalPageUrls.filter(u => u.trim()).map(u => u.trim()),
        }
        if (draftDocumentId) body.documentId = draftDocumentId
        const res = await fetch('/api/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const resBody = await res.json().catch(() => ({}))
          throw new Error(resBody.error ?? 'Failed to save draft.')
        }
        const resBody = await res.json().catch(() => ({}))
        if (draftDocumentId) {
          // Re-save: snapshot route updated content; also update metadata and rubrics
          await updateDraftMetadata(supabase, draftDocumentId, sharedMeta)
          await assignRubrics(supabase, draftDocumentId, rubricIds)
        } else if (resBody.documentId) {
          // Initial save: snapshot route created the doc and assigned rubrics
          setDraftDocumentId(resBody.documentId)
        }
      }

      router.refresh()
      resetAll()
      onClose()
    } catch (err) {
      console.error('Draft save failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to save draft. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function toggleRubric(id: string) {
    touch()
    setSelectedRubrics(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else if (next.size < 6) {
        next.add(id)
      }
      return next
    })
  }

  // ── Step validation ───────────────────────────────────────────────────────

  function handleContinueStep1() {
    if (!title.trim())                    { setError('Resource title is required.'); return }
    if (!authors.trim())                  { setError('Author(s) is required.'); return }
    if (!subjectMatter)                   { setError('Subject area is required.'); return }
    if (isOther && !customSubject.trim()) { setError('Please enter a subject area.'); return }
    if (sourceTab === 'pdf') {
      if (!file)                                     { setError('Please select a PDF file.'); return }
      if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files are supported.'); return }
      //Change to regular URL upload     
    } else if (sourceTab === 'torus') {
      if (!torusUrl.trim()) { setError('Please enter an OLI Torus URL.'); return }
      if (!isTorusUrl(torusUrl.trim())) {
        setError('URL must be from OLI Torus (proton.oli.cmu.edu).')
        return
      }
    } else {
      if (!openstaxUrl.trim()) { setError('Please enter an OER URL.'); return }
      if (!isValidOerUrl(openstaxUrl.trim())) {
        setError('URL must be a valid public https link.')
        return
      }
      for (const pageUrl of additionalPageUrls) {
        if (!pageUrl.trim()) { setError('Remove empty page URL fields or fill them in.'); return }
        try {
          new URL(pageUrl.trim())
        } catch {
          setError('Please enter a valid URL for each additional page.'); return
        }
        if (!isValidOerUrl(pageUrl.trim())) {
          setError(`Additional page URL must be a valid public https link: ${pageUrl.trim()}`); return
        }
      }
    }
    setError(null)
    setStep(2)
  }

  function handleContinueStep2() {
    if (selectedRubrics.size === 0) {
      setRubricError('Please select at least one rubric to continue.')
      return
    }
    setRubricError(null)
    setStep(3)
  }

  function handleContinueStep3() {
    if (!ccLicense) { setError('Please select a Creative Commons license.'); return }
    setError(null)
    setStep(4)
  }

  function goBack() {
    setError(null)
    setRubricError(null)
    setStep(s => s - 1)
  }

  // ── Submission — logic preserved exactly from UploadDocumentForm ──────────

  async function handleSubmit() {
    setError(null)
    setLoading(true)
    try {
      if (sourceTab === 'pdf') {
        const doc = await uploadDocument(
          supabase, file!, title.trim(), 'pdf', authors.trim(), finalSubjectMatter,
          ccLicense as CreativeCommonsLicense, thirdPartyDisclosure.trim() || null,
          [submissionScope], false, false, publicReview ?? false,
        )
        if (selectedRubrics.size > 0) {
          await assignRubrics(supabase, doc.id, Array.from(selectedRubrics))
        }
      } else if (sourceTab === 'torus') {
        await submitTorusLink(supabase, {
          url: torusUrl.trim(),
          title: title.trim(),
          authors: authors.trim(),
          subjectMatter: finalSubjectMatter,
          ccLicense: ccLicense as CreativeCommonsLicense,
          thirdPartyDisclosure: thirdPartyDisclosure.trim() || null,
          courseAccessCode: torusCourseAccessCode.trim() || null,
          rubricIds: Array.from(selectedRubrics),
          submissionScope: [submissionScope],
          isDraft: false,
          coordinatorUpload: false,
          publicReview: publicReview ?? false,
        })
      } else {
        const res = await fetch('/api/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: openstaxUrl.trim(),
            title: title.trim(),
            authors: authors.trim(),
            subjectMatter: finalSubjectMatter,
            ccLicense,
            thirdPartyDisclosure: thirdPartyDisclosure.trim() || undefined,
            rubricIds: Array.from(selectedRubrics),
            submissionScope: [submissionScope],
            publicReview,
            additionalPageUrls: additionalPageUrls.filter(u => u.trim()).map(u => u.trim()),
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? 'Failed to fetch OER content.')
        }
      }
      router.refresh()
      resetAll()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ── Step panels ───────────────────────────────────────────────────────────

  const step1Content = (
    <div className="space-y-6">
      <Input
        label="Resource Title"
        placeholder="e.g. Quantum Mechanics: An Open Resource"
        value={title}
        onChange={e => { setTitle(e.target.value); touch() }}
        disabled={loading}
      />

      <Input
        label="Author(s)"
        placeholder="e.g. Jane Smith, John Doe"
        value={authors}
        onChange={e => { setAuthors(e.target.value); touch() }}
        disabled={loading}
        helperText="Separate multiple authors with commas"
      />

      <Select
        label="Subject Area"
        value={subjectMatter}
        onChange={e => {
          setSubjectMatter(e.target.value)
          if (e.target.value !== OTHER_SENTINEL) setCustomSubject('')
          touch()
        }}
        disabled={loading}
      >
        <option value="">Select a subject area…</option>
        <optgroup label="Standard domains">
          {PREDEFINED_ENTRIES.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </optgroup>
        {customSubjectMatters.length > 0 && (
          <optgroup label="Community-added">
            {customSubjectMatters.map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </optgroup>
        )}
        <option value={OTHER_SENTINEL}>Other (specify below)…</option>
      </Select>

      {isOther && (
        <Input
          placeholder="Enter a subject area"
          value={customSubject}
          onChange={e => { setCustomSubject(e.target.value); touch() }}
          disabled={loading}
          autoFocus
        />
      )}

      {/* Resource Type */}
      <div>
        <p className="text-label-md font-label font-semibold uppercase tracking-wide text-text-secondary mb-4">
          Resource Type
        </p>
        <div className="grid grid-cols-3 gap-3">
          <SelectionCard
            selectionMode="radio"
            isSelected={sourceTab === 'openstax'}
            onChange={() => { setSourceTab('openstax'); touch() }}
            disabled={loading}
            title="OpenStax or Pressbooks"
            size="compact"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
            }
          />
          <SelectionCard
            selectionMode="radio"
            isSelected={sourceTab === 'torus'}
            onChange={() => { setSourceTab('torus'); touch() }}
            disabled={loading}
            title="OLI Torus"
            size="compact"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
                <polygon points="10 7 15 10 10 13 10 7" />
              </svg>
            }
          />
          <SelectionCard
            selectionMode="radio"
            isSelected={sourceTab === 'pdf'}
            onChange={() => { setSourceTab('pdf'); touch() }}
            disabled={loading}
            title="PDF"
            size="compact"
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            }
          />
        </div>
      </div>

      {/* Conditional source input */}
      {sourceTab === 'torus' ? (
        <div className="space-y-4">
          <Input
            label="Torus Course URL"
            placeholder="https://torus.oli.cmu.edu/..."
            value={torusUrl}
            onChange={e => { setTorusUrl(e.target.value); touch() }}
            disabled={loading}
            helperText="Paste the URL to your OLI Torus course section."
          />
          <Input
            label="Course Access Code"
            optional
            placeholder="e.g. ABC-123"
            value={torusCourseAccessCode}
            onChange={e => { setTorusCourseAccessCode(e.target.value); touch() }}
            disabled={loading}
            helperText="If your course requires an access code, reviewers will need it to view the content."
          />
        </div>
      ) : sourceTab === 'openstax' ? (
        <div className="space-y-3">
          <Input
            label="Resource URL"
            placeholder="https://openstax.org/your-resource"
            value={openstaxUrl}
            onChange={e => { setOpenstaxUrl(e.target.value); touch() }}
            disabled={loading}
          />
          <ChapterPicker
            url={openstaxUrl}
            disabled={loading}
            onAdd={urls => {
              const { mainUrl, extraUrls } = mergeChapterPages(additionalPageUrls, urls)
              setOpenstaxUrl(mainUrl)
              setAdditionalPageUrls(extraUrls)
              touch()
            }}
          />
          {additionalPageUrls.map((pageUrl, i) => (
            <div key={i} className="flex items-end gap-2">
              <Input
                containerClassName="flex-1"
                type="url"
                placeholder="https://openstax.org/books/.../pages/..."
                value={pageUrl}
                onChange={e => { updatePageUrl(i, e.target.value); touch() }}
                disabled={loading}
              />
              <button
                type="button"
                onClick={() => removePageUrl(i)}
                disabled={loading}
                className="shrink-0 p-1.5 rounded-md text-text-secondary hover:text-text-primary hover:bg-[var(--color-surface-container)] transition-colors disabled:opacity-50"
                aria-label="Remove page"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
          <Button variant="text" size="sm" onClick={addPageUrl} disabled={loading}>
            + Add Page URL
          </Button>
          {additionalPageUrls.length > 0 && (
            <p className="text-body-sm text-text-secondary">
              Reviewers will see all {additionalPageUrls.length + 1} page{additionalPageUrls.length + 1 !== 1 ? 's' : ''} linked to this submission.
            </p>
          )}
        </div>
      ) : (
        <div>
          <p className="text-label-md font-label font-semibold uppercase tracking-wide text-text-secondary mb-4">
            PDF File
          </p>
          <div
            onClick={() => fileRef.current?.click()}
            className={cx(
              'flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-4 cursor-pointer transition-colors',
              file
                ? 'border-[var(--color-border-strong)] bg-[var(--color-surface-container)]'
                : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
            )}
          >
            <svg className="h-5 w-5 text-text-secondary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="text-body-sm text-text-secondary truncate">
              {file ? file.name : 'Click to select a PDF file'}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={e => { setFile(e.target.files?.[0] ?? null); touch() }}
              disabled={loading}
            />
          </div>
        </div>
      )}

      {/* Submit for Review To */}
      <div>
        <p className="text-label-md font-label font-semibold uppercase tracking-wide text-text-secondary mb-4">
          Submit for Review To
        </p>
        <div className="grid grid-cols-2 gap-3">
          <SelectionCard
            selectionMode="radio"
            isSelected={submissionScope === 'organization'}
            onChange={() => { setSubmissionScope('organization'); touch() }}
            disabled={loading}
            title="My Organization"
            description={authorInstitution ? `Held for coordinator approval at ${authorInstitution}` : 'Held for coordinator approval'}
          />
          <SelectionCard
            selectionMode="radio"
            isSelected={submissionScope === 'public'}
            onChange={() => { setSubmissionScope('public'); touch() }}
            disabled={loading}
            title="Public Pool"
            description="Visible to all eligible reviewers"
          />
        </div>
      </div>

      <Textarea
        label="Third-Party Content Disclosure"
        optional
        placeholder="Describe any third-party content included in this OER (e.g. images, excerpts) and confirm you have rights to use it"
        value={thirdPartyDisclosure}
        onChange={e => { setThirdPartyDisclosure(e.target.value); touch() }}
        disabled={loading}
        rows={3}
        resize="none"
      />

      {error && (
        <p className="text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  )

  const step2Content = (
    <div className="space-y-4">
      <p className="text-body-sm text-text-secondary">
        Select the rubrics reviewers should apply to this resource. Choose between 1 and 6.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {rubrics.map(r => {
          const maxReached = selectedRubrics.size >= 6 && !selectedRubrics.has(r.id)
          return (
            <SelectionCard
              key={r.id}
              selectionMode="checkbox"
              isSelected={selectedRubrics.has(r.id)}
              onChange={() => toggleRubric(r.id)}
              disabled={loading || maxReached}
              title={r.title}
              description={r.description ?? undefined}
            />
          )
        })}
      </div>
      {rubricError && (
        <p className="text-body-sm text-[var(--color-error)]">{rubricError}</p>
      )}
      {error && (
        <p className="text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  )

  const step3Content = (
    <div>
      <p className="text-body-sm text-text-secondary mb-5">
        Choose the Creative Commons license that applies to this resource.
      </p>
      <div className="grid grid-cols-2 gap-3">
        {(Object.entries(CC_LICENSE_LABELS) as [CreativeCommonsLicense, string][]).map(([key, label]) => (
          <SelectionCard
            key={key}
            selectionMode="radio"
            isSelected={ccLicense === key}
            onChange={() => { setCcLicense(key); touch() }}
            disabled={loading}
            title={label}
            description={CC_LICENSE_DESCRIPTIONS[key]}
          />
        ))}
      </div>
      {error && (
        <p className="mt-4 text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  )

  const selectedRubricNames = rubrics
    .filter(r => selectedRubrics.has(r.id))
    .map(r => r.title)

  const reviewRows = [
    { label: 'Title',         value: title || '—' },
    { label: 'Author(s)',     value: authors || '—' },
    { label: 'Subject Area',  value: isOther ? (customSubject || '—') : ((EXPERT_DOMAIN_LABELS[subjectMatter as ExpertDomain] ?? subjectMatter) || '—') },
    { label: 'Resource Type', value: sourceTab === 'pdf' ? `PDF — ${file?.name ?? ''}` : sourceTab === 'torus' ? `OLI Torus — ${torusUrl}` : `OER URL — ${openstaxUrl}` },
    ...(sourceTab === 'torus' && torusCourseAccessCode.trim()
      ? [{ label: 'Access Code', value: torusCourseAccessCode.trim() }]
      : []),
    ...(sourceTab === 'openstax' && additionalPageUrls.filter(u => u.trim()).length > 0
      ? [{ label: 'Additional Pages', value: `${additionalPageUrls.filter(u => u.trim()).length} additional page(s)` }]
      : []),
    { label: 'Submit to',     value: submissionScope === 'organization' ? 'My Organization' : 'Public Pool' },
    { label: 'Rubrics',       value: selectedRubricNames.join(', ') || '—' },
    { label: 'License',       value: ccLicense ? CC_LICENSE_LABELS[ccLicense as CreativeCommonsLicense] : '—' },
    { label: 'Visibility',    value: publicReview ? 'Public' : 'Private' },
    ...(thirdPartyDisclosure ? [{ label: 'Third-Party Disclosure', value: thirdPartyDisclosure }] : []),
  ]

  const step4Content = (
    <div>
      <p className="text-body-sm text-text-secondary mb-5">
        Should this review be public or private?
      </p>
      <div className="grid grid-cols-2 gap-3">
        <SelectionCard
          selectionMode="radio"
          isSelected={publicReview === true}
          onChange={() => { setPublicReview(true); touch() }}
          disabled={loading}
          title="Public"
          description="Once feedback is ready, you can choose to publish this review to the O4PR site for adopters to browse. Reviewers will know this review may become public."
          icon={
            <svg className="w-full h-full" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="8" cy="8" r="6" />
              <path d="M2 8h12" />
              <path d="M8 2a9.6 9.6 0 0 1 2.5 6A9.6 9.6 0 0 1 8 14 9.6 9.6 0 0 1 5.5 8 9.6 9.6 0 0 1 8 2z" />
            </svg>
          }
        />
        <SelectionCard
          selectionMode="radio"
          isSelected={publicReview === false}
          onChange={() => { setPublicReview(false); touch() }}
          disabled={loading}
          title="Private"
          description="Stays within your organization only. Never appears on the public site. This choice can't be changed later."
          icon={
            <svg className="w-full h-full" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="7" width="10" height="8" rx="1" />
              <path d="M5 7V5a3 3 0 016 0v2" />
            </svg>
          }
        />
      </div>
      {error && (
        <p className="mt-4 text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  )

  const step5Content = (
    <div className="space-y-5">
      <p className="text-body-sm text-text-secondary">
        Review your submission before sending it for certification.
      </p>
      <div className="rounded-lg border border-[var(--color-border)] divide-y divide-[var(--color-border)]">
        {reviewRows.map(({ label, value }) => (
          <div key={label} className="px-4 py-3 flex gap-4">
            <span className="text-body-sm font-medium text-text-secondary shrink-0 w-44">{label}</span>
            <span className="text-body-sm text-text-primary break-words min-w-0">{value}</span>
          </div>
        ))}
      </div>
      {error && (
        <p className="text-body-sm text-[var(--color-error)] bg-[var(--color-error-container)] rounded-lg px-3.5 py-2.5">
          {error}
        </p>
      )}
    </div>
  )

  // ── Footer ────────────────────────────────────────────────────────────────

  const footer = (
    <div className="shrink-0 flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--color-border)] bg-[var(--color-surface-card)]">
      <div className="flex items-center gap-3">
        {step === 1 ? (
          title.trim() ? (
            <Button variant="text" size="md" onClick={handleSaveAsDraft} disabled={loading}>
              Save & Exit
            </Button>
          ) : (
            <Button variant="secondary" size="md" onClick={handleCloseAttempt} disabled={loading}>
              Cancel
            </Button>
          )
        ) : (
          <>
            <Button variant="secondary" size="md" onClick={goBack} disabled={loading}>
              ← Back
            </Button>
            <Button variant="text" size="md" onClick={handleSaveAsDraft} disabled={loading}>
              Save & Exit
            </Button>
          </>
        )}
      </div>
      <div>
        {step < 5 ? (
          <Button
            variant="primary"
            size="md"
            disabled={loading || (step === 4 && publicReview === null)}
            onClick={() => {
              if (step === 1) handleContinueStep1()
              else if (step === 2) handleContinueStep2()
              else if (step === 3) handleContinueStep3()
              else if (step === 4) setStep(5)
            }}
          >
            Continue →
          </Button>
        ) : (
          <Button variant="primary" size="md" loading={loading} onClick={handleSubmit}>
            Submit for Review
          </Button>
        )}
      </div>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Modal open={isOpen} onClose={handleCloseAttempt}>
        <ModalContent className="max-w-2xl">
          <div className="flex flex-col h-full">

            {/* Header */}
            <div className="shrink-0 px-6 pt-6 pb-5 border-b border-[var(--color-border)]">
              <div className="flex items-start justify-between gap-4 mb-5">
                <div>
                  <p className="text-label-sm font-label font-semibold uppercase tracking-widest text-text-secondary mb-1">
                    Submit for Certification
                  </p>
                  <h2 className="font-heading text-title-lg text-text-primary leading-snug">
                    New Resource Submission
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={handleCloseAttempt}
                  className="shrink-0 rounded-md p-1 text-text-muted hover:text-text-primary hover:bg-surface-container transition-colors duration-150"
                  aria-label="Close"
                >
                  <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                </button>
              </div>
              <StepIndicator steps={STEPS} currentStep={step} />
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-6">
              {step === 1 && step1Content}
              {step === 2 && step2Content}
              {step === 3 && step3Content}
              {step === 4 && step4Content}
              {step === 5 && step5Content}
            </div>

            {footer}

          </div>
        </ModalContent>
      </Modal>

      <ConfirmationDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        title="Exit submission?"
        message="Do you want to save your progress before exiting?"
        confirmLabel="Save as draft"
        discardLabel="Discard"
        onConfirm={() => {
          setShowConfirmDialog(false)
          handleSaveAsDraft()
        }}
        onDiscard={() => {
          setShowConfirmDialog(false)
          resetAll()
          onClose()
        }}
      />
    </>
  )
}
