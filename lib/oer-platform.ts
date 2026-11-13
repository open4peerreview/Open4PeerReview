const OLI_TORUS_RULES = [
  (h: string) => h === 'proton.oli.cmu.edu' || h.endsWith('.proton.oli.cmu.edu'),
]

export function isTorusUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return OLI_TORUS_RULES.some(r => r(hostname))
  } catch {
    return false
  }
}

const PLATFORM_RULES: { match: (hostname: string) => boolean; name: string }[] = [
  {
    name: 'OpenStax',
    match: h => h === 'openstax.org' || h.endsWith('.openstax.org'),
  },
  {
    name: 'Pressbooks',
    match: h =>
      h === 'pressbooks.com' ||
      h.endsWith('.pressbooks.com') ||
      h.endsWith('.pressbooks.pub'),
  },
  {
    name: 'OER Commons',
    match: h => h === 'oercommons.org' || h.endsWith('.oercommons.org'),
  },
  {
    name: 'LibreTexts',
    match: h => h === 'libretexts.org' || h.endsWith('.libretexts.org'),
  },
  {
    name: 'MERLOT',
    match: h => h === 'merlot.org' || h.endsWith('.merlot.org'),
  },
  {
    name: 'Open Textbook Library',
    match: h => h === 'open.umn.edu',
  },
  {
    name: 'Siyavula',
    match: h => h === 'siyavula.com' || h.endsWith('.siyavula.com'),
  },
]

export function detectPlatform(url: string): string {
  try {
    const { hostname } = new URL(url)
    return PLATFORM_RULES.find(r => r.match(hostname))?.name ?? 'Other'
  } catch {
    return 'Other'
  }
}

/** Hostnames that must never be fetched or accepted (loopback, private, link-local, internal). */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (!h.includes('.') && !h.includes(':')) return true // single-label hosts (intranet)
  if (h.includes(':')) {
    // IPv6 literal: loopback, unspecified, unique-local, link-local, v4-mapped
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h) || h.startsWith('::ffff:')
  }
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    )
  }
  return false
}

/** Any public https URL is accepted; unrecognised hosts are labelled "Other". */
export function isValidOerUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !u.username && !u.password && !isPrivateHostname(u.hostname)
  } catch {
    return false
  }
}

export function getHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

/**
 * Pressbooks books are often served from a custom domain (e.g. open.maricopa.edu).
 * Detect them from the page markup: the generator meta tag or Pressbooks theme/plugin assets.
 */
export function detectPlatformFromHtml(html: string): string | null {
  const head = html.slice(0, 200_000)
  if (/<meta[^>]+name=["']generator["'][^>]+content=["'][^"']*pressbooks/i.test(head)) return 'Pressbooks'
  if (/<meta[^>]+content=["'][^"']*pressbooks[^"']*["'][^>]+name=["']generator["']/i.test(head)) return 'Pressbooks'
  // Some Pressbooks networks (including Maricopa) serve WordPress assets under /app.
  if (/\/(?:wp-content|app)\/(?:themes|plugins)\/pressbooks/i.test(head)) return 'Pressbooks'
  return null
}

/** "Pressbooks" + "Salt Lake Community College" -> "Pressbooks (Salt Lake Community College)". */
export function platformLabel(base: string, institution: string | null | undefined): string {
  const inst = institution?.trim()
  return base === 'Pressbooks' && inst ? `Pressbooks (${inst})` : base
}

/** Strip the institution suffix: "Pressbooks (SLCC)" -> "Pressbooks". */
export function basePlatform(label: string): string {
  return label.replace(/\s*\(.*\)$/, '')
}
