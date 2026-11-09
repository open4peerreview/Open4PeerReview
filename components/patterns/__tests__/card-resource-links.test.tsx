import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DocumentCard } from '../DocumentCard'
import { ReviewerCard } from '../ReviewerCard'
import { CompletedReviewCard } from '../CompletedReviewCard'
import { TaskPoolCard } from '../TaskPoolCard'
import { DraftCard } from '../DraftCard'
import { CoordinatorReviewCard } from '@/app/coordinator/components/CoordinatorReviewCard'
import { NeedAssignmentCard } from '@/app/coordinator/components/NeedAssignmentCard'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('@/app/coordinator/actions', () => ({ assignAndReleaseDocument: vi.fn() }))

const id = '8f79f098-67e7-4f60-b347-d3ce08f89846'
const date = '2026-11-03T12:00:00Z'
const common = { id, title: 'Sample resource', platform: 'Pressbooks', discipline: 'Education' }
const metadata = { ccLicense: 'CC BY', description: 'A resource for review.' }

describe('dashboard resource links', () => {
  it.each([
    ['author', <DocumentCard key="DocumentCard" {...common} {...metadata} authors="Author" submittedAt={date} rubrics={[]} />],
    ['reviewer', <ReviewerCard key="ReviewerCard" {...common} {...metadata} authorName="Author" claimedAt={date} rubrics={[]} hasGeneralComment={false} />],
    ['completed review', <CompletedReviewCard key="CompletedReviewCard" {...common} authorName="Author" completedAt={date} rubrics={[]} reviewUrl="/report" />],
    ['task pool', <TaskPoolCard key="TaskPoolCard" {...common} {...metadata} authorName="Author" submittedAt={date} rubrics={[]} />],
    ['author draft', <DraftCard key="DraftCard" {...common} savedAt={date} rubrics={[]} onContinue={() => {}} />],
    ['coordinator', <CoordinatorReviewCard key="CoordinatorReviewCard" {...common} {...metadata} authors="Author" submittedAt={date} rubrics={[]} />],
    ['coordinator assignment', <NeedAssignmentCard key="NeedAssignmentCard" doc={{ id, title: 'Sample resource', file_type: 'pdf', created_at: date, author: null, document_rubrics: [] }} orgReviewers={[]} />],
  ])('%s card exposes its resource label as a new-tab link', (_name, card) => {
    const html = renderToStaticMarkup(card)
    const links = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)]
    const resourceLink = links.find(([link]) => link.includes(`href="/api/documents/${id}/resource"`))?.[0]
    expect(resourceLink).toBeDefined()
    expect(resourceLink).toContain('target="_blank"')
    expect(resourceLink).toContain('rel="noopener noreferrer"')
    expect(resourceLink).toContain('opens in a new tab')
  })
})
