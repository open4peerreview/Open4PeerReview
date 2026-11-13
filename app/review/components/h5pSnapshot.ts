import { h5pEmbedUrl, type H5pActivity } from '@/lib/h5p'

export interface SnapshotActivity extends H5pActivity {
  key: string
  placeholder: HTMLElement
  row: HTMLTableRowElement | null
  toggle: HTMLButtonElement | null
}

export function setActivityRowOpen(activity: SnapshotActivity, open: boolean): void {
  if (!activity.row) return
  activity.row.hidden = !open
  activity.row.style.display = open ? 'table-row' : 'none'
  const toggle = activity.toggle
  if (toggle) {
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', open ? 'Hide activity' : 'Show activity')
  }
}

export function mountSnapshotActivities(doc: Document): SnapshotActivity[] {
  const metadata = doc.head.querySelector('script[data-open4pr="h5p"]')?.textContent
  if (!metadata) return []

  let parsed: { sourceUrl: string; pressbooks: boolean; activities: Record<string, H5pActivity> } | null
  try {
    parsed = JSON.parse(metadata)
  } catch {
    return []
  }
  if (!parsed) return []
  const { sourceUrl, pressbooks, activities } = parsed
  if (typeof sourceUrl !== 'string' || !activities || typeof activities !== 'object') return []
  const players: SnapshotActivity[] = []
  for (const [index, node] of [...doc.body.querySelectorAll('iframe, .h5p-content[data-content-id]')].entries()) {
    const contentId = node.getAttribute('data-content-id')
    const fromBook = contentId && /^\d+$/.test(contentId) ? activities[contentId] : undefined
    const direct = node.getAttribute('src')
    const url = (direct && h5pEmbedUrl(direct, sourceUrl, pressbooks))
      || (fromBook?.url && h5pEmbedUrl(fromBook.url, sourceUrl, pressbooks))
    if (!url || new URL(url).origin === doc.location.origin) continue

    const placeholder = doc.createElement('div')
    placeholder.style.minHeight = '1px'
    placeholder.style.width = '100%'
    const row = node.closest<HTMLTableRowElement>('tr.h5p-activity-container')
    const toggle = row?.previousElementSibling?.querySelector<HTMLButtonElement>('button[h5p-id]') ?? null
    node.replaceWith(placeholder)
    const activity = {
      key: String(index),
      url,
      title: fromBook?.title || node.getAttribute('title')?.trim() || 'H5P activity',
      placeholder,
      row,
      toggle,
    }
    if (toggle) {
      toggle.classList.add('o4pr-h5p-toggle')
      toggle.type = 'button'
      toggle.addEventListener('click', () => setActivityRowOpen(activity, Boolean(row?.hidden)))
    }
    setActivityRowOpen(activity, false)
    players.push(activity)
  }

  const expandAll = doc.querySelector<HTMLButtonElement>('#h5p-show-hide')
  if (expandAll && players.some(player => player.row)) {
    expandAll.classList.add('o4pr-h5p-expand')
    expandAll.setAttribute('aria-label', 'Expand all')
    expandAll.addEventListener('click', () => {
      const open = players.some(player => player.row?.hidden)
      for (const player of players) setActivityRowOpen(player, open)
      expandAll.setAttribute('aria-label', open ? 'Hide all' : 'Expand all')
    })
  }
  if (players.some(player => player.row)) {
    const style = doc.createElement('style')
    style.textContent = '.o4pr-h5p-toggle:empty::before, .o4pr-h5p-expand:empty::before { content: attr(aria-label); }'
    doc.head.appendChild(style)
  }
  return players
}
