import { isValidOerUrl } from '@/lib/oer-platform'

export interface H5pActivity {
  url: string
  title?: string
}

export function h5pEmbedUrl(value: string, base: string, pressbooks = false): string | null {
  try {
    const url = new URL(value, base)
    if (!isValidOerUrl(url.href)) return null
    const wordpressEmbed = pressbooks && url.origin === new URL(base).origin
      && url.pathname.endsWith('/wp-admin/admin-ajax.php')
      && url.searchParams.get('action') === 'h5p_embed'
      && /^\d+$/.test(url.searchParams.get('id') ?? '')
    const hostedEmbed = /\/h5p\/embed\/[^/]+\/?$/.test(url.pathname)
      || /(?:^|\.)h5p\.com$/i.test(url.hostname) && /\/content\/\d+\/embed\/?$/.test(url.pathname)
    return wordpressEmbed || hostedEmbed ? url.href : null
  } catch {
    return null
  }
}

/** Read embed addresses declared by the publisher without running its scripts. */
export function readH5pIntegration(script: string, base: string, pressbooks: boolean): Record<string, H5pActivity> {
  const match = /^\s*(?:(?:var|let|const)\s+)?(?:window\.)?H5PIntegration\s*=\s*(\{[\s\S]*\})\s*;?\s*$/.exec(script)
  if (!match) return {}
  try {
    const integration = JSON.parse(match[1])
    const activities: Record<string, H5pActivity> = {}
    for (const [key, content] of Object.entries(integration?.contents ?? {})) {
      if (!/^cid-\d+$/.test(key)) continue
      const entry = content as { url?: unknown; title?: unknown; displayOptions?: { embed?: boolean } } | null
      if (typeof entry?.url !== 'string' || entry.displayOptions?.embed === false) continue
      const url = h5pEmbedUrl(entry.url, base, pressbooks)
      if (url) activities[key.slice(4)] = { url, title: typeof entry.title === 'string' ? entry.title : undefined }
    }
    return activities
  } catch {
    return {}
  }
}
