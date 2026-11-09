import { createClient } from '@/lib/supabase/server'
import { getAllDocumentsWithRubrics } from '@/lib/supabase/queries'
import { EXPERT_DOMAIN_LABELS, CC_LICENSE_LABELS } from '@/types'
import type { ExpertDomain, CreativeCommonsLicense } from '@/types'
import { ReviewerDashboardClient } from './ReviewerDashboardClient'

interface Props {
  userId: string
  displayName: string
}

export async function ReviewerDashboard({ userId, displayName }: Props) {
  const supabase = await createClient()
  const documents = await getAllDocumentsWithRubrics(supabase)

  // Fetch coordinator assignments for this reviewer (non-declined only)
  const { data: assignmentsData } = await supabase
    .from('document_assignments')
    .select('document_id')
    .eq('reviewer_id', userId)
    .is('declined_at', null)
  const assignedIds = new Set((assignmentsData ?? []).map(a => a.document_id))

  type ReviewScoreRow = { id: string; rubric_item_id: string; criterion_scores: string[] }
  type ReviewRow = { id: string; status: string; reviewer_id: string; submitted_at: string | null; rubric_id: string | null; notes: string | null; review_scores: ReviewScoreRow[]; review_rubric_submissions?: { rubric_id: string }[] }
  type AuthorRow = { display_name: string | null; email: string } | null
  type Doc = (typeof documents)[number]

  function getFileLabel(fileType: string | null): string {
    if (fileType === 'pdf') return 'PDF'
    if (fileType === 'html') return 'Web URL'
    return fileType?.toUpperCase() ?? ''
  }

  type RubricRow = { id: string; title: string; rubric_items?: { id: string }[] }

  function mapRubrics(doc: Doc) {
    return (doc.document_rubrics ?? [])
      .map(dr => dr.rubric as RubricRow | null)
      .filter((r): r is RubricRow => r !== null)
  }

  // Each rubric assigned to a document has its own independent review row
  // (document_id, rubric_id, reviewer_id) — never collapse them into "the" review.
  function mapRubricsWithProgress(doc: Doc) {
    const reviews = (doc.reviews ?? []) as ReviewRow[]
    const myReviews = reviews.filter(rev => rev.reviewer_id === userId)
    return mapRubrics(doc).map(r => {
      const myReview = myReviews.find(rev => rev.rubric_id === r.id) ?? null
      const myScores = myReview?.review_scores ?? []
      const rubricItemIds = new Set((r.rubric_items ?? []).map(item => item.id))
      const totalCount = rubricItemIds.size
      const ratedCount = myScores.filter(
        rs => rubricItemIds.has(rs.rubric_item_id) && (rs.criterion_scores ?? []).length > 0
      ).length
      // Per-rubric submission is tracked in review_rubric_submissions, not reviews.status —
      // reviews.status only flips to 'submitted' when ALL rubrics are done.
      const perRubricSubmitted = (myReview?.review_rubric_submissions ?? []).length > 0
      const status = perRubricSubmitted || myReview?.status === 'submitted' ? 'submitted' : (myReview?.status ?? null)
      return {
        rubricId: r.id,
        rubricTitle: r.title,
        ratedCount,
        totalCount,
        reviewId: myReview?.id ?? null,
        status,
      }
    })
  }

  const activeReviews: Doc[] = []
  const taskPool: Doc[] = []
  const completedReviews: Doc[] = []

  for (const doc of documents) {
    const reviews = (doc.reviews ?? []) as ReviewRow[]
    const myReviews = reviews.filter(r => r.reviewer_id === userId)
    // A document can have several independent per-rubric reviews at once —
    // surface it as "active" if any rubric still needs work.
    const hasInProgress = myReviews.some(r => r.status === 'in_progress')
    const allSubmitted = myReviews.length > 0 && myReviews.every(r => r.status === 'submitted')
    if (hasInProgress) activeReviews.push(doc)
    else if (allSubmitted) completedReviews.push(doc)
    else if (assignedIds.has(doc.id)) taskPool.push(doc)
  }

  const byTitle = (a: Doc, b: Doc) => a.title.localeCompare(b.title)
  activeReviews.sort(byTitle)
  completedReviews.sort(byTitle)
  taskPool.sort(byTitle)

  // Map to client prop shapes
  const activeCards = activeReviews.map(doc => {
    const author = doc.author as AuthorRow
    const reviews = (doc.reviews ?? []) as ReviewRow[]
    const myReviews = reviews.filter(r => r.reviewer_id === userId)
    const hasGeneralComment = myReviews.some(r => typeof r.notes === 'string' && r.notes.trim().length > 0)
    const rubrics = mapRubricsWithProgress(doc)
    // Default tab: the rubric that's actively in progress, else the first assigned rubric.
    const defaultRubric = rubrics.find(r => r.status === 'in_progress') ?? rubrics[0] ?? null
    return {
      id: doc.id,
      title: doc.title,
      platform: doc.platform ?? getFileLabel(doc.file_type),
      authorName: author?.display_name ?? author?.email ?? 'Unknown',
      discipline: EXPERT_DOMAIN_LABELS[doc.subject_matter as ExpertDomain] ?? doc.subject_matter ?? '',
      ccLicense: CC_LICENSE_LABELS[doc.creative_commons_license as CreativeCommonsLicense] ?? doc.creative_commons_license ?? '',
      description: doc.third_party_content_disclosure ?? '',
      claimedAt: doc.created_at,
      rubrics,
      hasGeneralComment,
      sourceUrl: doc.source_url ?? null,
      courseAccessCode: doc.course_access_code ?? null,
      defaultRubricId: defaultRubric?.rubricId ?? null,
      publicReview: doc.public_review ?? false,
    }
  })


  const completedCards = completedReviews.map(doc => {
    const author = doc.author as AuthorRow
    const reviews = (doc.reviews ?? []) as ReviewRow[]
    const submittedReviews = reviews.filter(r => r.reviewer_id === userId && r.status === 'submitted')
    const latestSubmitted = submittedReviews.reduce<ReviewRow | null>(
      (latest, r) => !latest || (r.submitted_at ?? '') > (latest.submitted_at ?? '') ? r : latest,
      null
    )
    return {
      id: doc.id,
      title: doc.title,
      platform: getFileLabel(doc.file_type),
      authorName: author?.display_name ?? author?.email ?? 'Unknown',
      discipline: EXPERT_DOMAIN_LABELS[doc.subject_matter as ExpertDomain] ?? doc.subject_matter ?? '',
      rubrics: mapRubrics(doc).map(r => ({ rubricId: r.id, rubricTitle: r.title })),
      completedAt: latestSubmitted?.submitted_at ?? doc.created_at,
      reviewUrl: `/author/feedback/${doc.id}?from=reviewer&view=report`,
      publicReview: doc.public_review ?? false,
    }
  })

  const taskCards = taskPool.map(doc => {
    const author = doc.author as AuthorRow
    return {
      id: doc.id,
      title: doc.title,
      platform: getFileLabel(doc.file_type),
      authorName: author?.display_name ?? author?.email ?? 'Unknown',
      discipline: EXPERT_DOMAIN_LABELS[doc.subject_matter as ExpertDomain] ?? doc.subject_matter ?? '',
      ccLicense: CC_LICENSE_LABELS[doc.creative_commons_license as CreativeCommonsLicense] ?? doc.creative_commons_license ?? '',
      description: doc.third_party_content_disclosure ?? '',
      submittedAt: doc.created_at,
      publicReview: doc.public_review ?? false,
      rubrics: mapRubrics(doc).map(r => ({ rubricId: r.id, rubricTitle: r.title })),
    }
  })

  return (
    <ReviewerDashboardClient
      displayName={displayName}
      activeCards={activeCards}
      completedCards={completedCards}
      taskCards={taskCards}
    />
  )
}
