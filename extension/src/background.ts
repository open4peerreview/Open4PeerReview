import type {
  BackgroundMessage,
  BackgroundResponse,
  StoredAuth,
  CriterionScore,
  HighlightTag,
  Anchor,
} from './types';

const SUPABASE_URL = "https://nkcyjfuzmmkuavhmqyvu.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rY3lqZnV6bW1rdWF2aG1xeXZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2ODMyNzksImV4cCI6MjA5MTI1OTI3OX0._KEfRSNTIehhl2biJnixwl3yjf_Y2zylWKsOhcBXLeU";
const SCREENSHOTS_BUCKET = 'screenshots';

// ── Auto-login + deep-link capture: read params before any page redirect ──────
// onBeforeNavigate fires before the request is sent, so we save both the auth
// token AND the deep-link intent (which review / which annotation) before Torus
// can redirect through its login page and strip the query params. The content
// script alone can't rely on window.location — by the time it runs the params
// may already be gone, which previously routed the reviewer to the wrong rubric.

const PENDING_DEEP_LINK_KEY = 'oer_pending_review';

chrome.webNavigation.onBeforeNavigate.addListener(
  (details) => {
    if (details.frameId !== 0) return; // main frame only
    let url: URL;
    try { url = new URL(details.url); } catch { return; }

    const rawToken = url.searchParams.get('oer_token');
    if (rawToken) {
      try {
        const auth = JSON.parse(decodeURIComponent(atob(rawToken))) as StoredAuth;
        if (auth.access_token && auth.user_id) {
          // Preserve platformUrl if already stored — the oer_token payload doesn't include it.
          chrome.storage.local.get('auth', ({ auth: existing }) => {
            const toStore = { ...auth, platformUrl: (existing as StoredAuth | undefined)?.platformUrl };
            chrome.storage.local.set({ auth: toStore });
          });
        }
      } catch { /* malformed token — ignore */ }
    }

    const reviewId = url.searchParams.get('oer_review_id');
    const annotationId = url.searchParams.get('oer_goto');
    if (reviewId || annotationId) {
      // Scoped to the navigating tab so another Torus tab can't consume it.
      chrome.storage.local.set({
        [`${PENDING_DEEP_LINK_KEY}:${details.tabId}`]: { reviewId, annotationId, ts: Date.now() },
      });
    }
  },
  { url: [{ hostContains: 'proton.oli.cmu.edu' }] },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(`${PENDING_DEEP_LINK_KEY}:${tabId}`);
});

// ── Message handler ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, sender, sendResponse) => {
    handleMessage(message, sender)
      .then(sendResponse)
      .catch((err: Error) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }
);

async function handleMessage(
  msg: BackgroundMessage,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse> {
  const auth = await getStoredAuth();

  switch (msg.type) {
    case 'GET_AUTH':
      return { success: true, data: auth };

    case 'LOGIN': {
      const { email, password } = msg.payload as { email: string; password: string };
      return login(email, password);
    }

    case 'LOGOUT':
      await chrome.storage.local.remove('auth');
      return { success: true };

    case 'CONSUME_DEEP_LINK': {
      const tabId = sender.tab?.id;
      if (tabId === undefined) return { success: true, data: null };
      const key = `${PENDING_DEEP_LINK_KEY}:${tabId}`;
      const stored = await chrome.storage.local.get(key);
      await chrome.storage.local.remove(key);
      return { success: true, data: stored[key] ?? null };
    }

    case 'CAPTURE_TAB': {
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;
      if (!tabId || windowId === undefined) return { success: false, error: 'No tab context' };
      return captureTab(windowId);
    }

    case 'UPLOAD_SCREENSHOT': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { png, reviewId } = msg.payload as { png: string; reviewId: string };
      return uploadScreenshot(png, reviewId, auth.access_token);
    }

    case 'GET_ASSIGNMENTS':
      if (!auth) return { success: false, error: 'Not authenticated' };
      return getAssignments(auth);

    case 'GET_REVIEW': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId } = msg.payload as { reviewId: string };
      return getReview(reviewId, auth);
    }

    case 'GET_RUBRIC_ITEMS': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { rubricId } = msg.payload as { rubricId: string };
      return get(`rubric_items?rubric_id=eq.${rubricId}&order=sort_order.asc`, auth.access_token);
    }

    case 'GET_ANNOTATIONS': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId } = msg.payload as { reviewId: string };
      return get(`annotations?review_id=eq.${reviewId}&order=created_at.asc`, auth.access_token);
    }

    case 'GET_SCORES': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId } = msg.payload as { reviewId: string };
      return get(`review_scores?review_id=eq.${reviewId}`, auth.access_token);
    }

    case 'GET_SCORE_COMMENTS': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId } = msg.payload as { reviewId: string };
      return get(`score_comments?review_id=eq.${reviewId}&order=created_at.asc`, auth.access_token);
    }

    case 'SAVE_SCORE_COMMENT': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { id, ...fields } = msg.payload as { id?: string } & Record<string, unknown>;
      if (id) {
        return patch(`score_comments?id=eq.${id}`, fields, auth.access_token);
      }
      return post('score_comments', fields, auth.access_token);
    }

    case 'DELETE_SCORE_COMMENT': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { id } = msg.payload as { id: string };
      return del(`score_comments?id=eq.${id}`, auth.access_token);
    }

    case 'SAVE_ANNOTATION': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { id, ...fields } = msg.payload as { id?: string } & Record<string, unknown>;
      if (id) {
        return patch(`annotations?id=eq.${id}`, fields, auth.access_token);
      }
      return post('annotations', fields, auth.access_token);
    }

    case 'UPDATE_ANNOTATION': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { id, ...fields } = msg.payload as { id: string } & Record<string, unknown>;
      return patch(`annotations?id=eq.${id}`, fields, auth.access_token);
    }

    case 'DELETE_ANNOTATION': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { id } = msg.payload as { id: string };
      return del(`annotations?id=eq.${id}`, auth.access_token);
    }

    case 'SAVE_SCORE': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      return upsertScore(msg.payload as unknown as SaveScorePayload, auth.access_token);
    }

    case 'SET_REVIEW_STATUS': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId, status } = msg.payload as { reviewId: string; status: string };
      return patch(`reviews?id=eq.${reviewId}`, { status }, auth.access_token);
    }

    case 'UPDATE_REVIEW_NOTES': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { reviewId, notes } = msg.payload as { reviewId: string; notes: string };
      return patch(`reviews?id=eq.${reviewId}`, { notes }, auth.access_token);
    }

    case 'UPDATE_DOCUMENT_PAGES': {
      if (!auth) return { success: false, error: 'Not authenticated' };
      const { documentId, storagePath, pageEntry } = msg.payload as {
        documentId: string;
        storagePath: string;
        pageEntry: { url: string; fingerprint: string; storagePath: string };
      };
      return callRpc('update_torus_document_pages', {
        p_document_id: documentId,
        p_storage_path: storagePath,
        p_page_entry: pageEntry,
      }, auth.access_token);
    }

    // ── Dashboard → background auth sync ────────────────────────────────────────

    case 'SYNC_AUTH': {
      // dashboard.ts sends the raw localStorage session object directly.
      // We use the sender's origin as platformUrl so storage reflects whichever
      // platform page triggered the sync (production, preview, or localhost).
      const s = msg.payload as {
        access_token?: string; refresh_token?: string;
        expires_at?: number; user?: { id: string; email: string };
      };
      if (!s.access_token || !s.user?.id) return { success: false, error: 'Invalid session' };
      const senderOriginSync = getSenderOrigin(sender);
      const authToStore: StoredAuth = {
        access_token: s.access_token,
        refresh_token: s.refresh_token ?? '',
        user_id: s.user.id,
        email: s.user.email ?? '',
        expires_at: s.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
        ...(senderOriginSync ? { platformUrl: senderOriginSync } : {}),
      };
      await chrome.storage.local.set({ auth: authToStore });
      return { success: true };
    }

    case 'SYNC_AUTH_FROM_COOKIES': {
      // Read Supabase session cookies from the actual platform page that sent this message.
      const senderOriginCookies = getSenderOrigin(sender);
      if (!senderOriginCookies) return { success: false, error: 'Could not determine platform origin' };
      const cookieAuth = await readSessionFromCookies(senderOriginCookies);
      if (cookieAuth) {
        // Merge: read existing auth first so we never silently drop a field another
        // code path (e.g. stampPlatformUrl) already wrote. Prefer existing platformUrl;
        // fall back to senderOriginCookies only if nothing is stored yet.
        const existingForCookies = (await chrome.storage.local.get('auth') as { auth?: StoredAuth }).auth;
        const platformUrl = existingForCookies?.platformUrl ?? senderOriginCookies;
        await chrome.storage.local.set({ auth: { ...cookieAuth, platformUrl } });
        return { success: true };
      }
      return { success: false, error: 'No session found in cookies' };
    }

    default:
      return { success: false, error: `Unknown message type` };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSenderOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin && sender.origin !== 'null') return sender.origin;
  try { return new URL(sender.tab?.url ?? '').origin; } catch { return null; }
}

// ── Supabase session from platform cookies ────────────────────────────────────
// chrome.cookies can read HttpOnly cookies — this works even when the session
// is set server-side by Next.js middleware. Pass the platform origin so this
// is not tied to any hardcoded domain.

const SUPABASE_REF = 'nkcyjfuzmmkuavhmqyvu';

async function readSessionFromCookies(platformOrigin: string): Promise<StoredAuth | null> {
  try {
    const cookies = await chrome.cookies.getAll({ url: platformOrigin });
    const prefix = `sb-${SUPABASE_REF}-auth-token`;

    // Try single cookie first
    const single = cookies.find(c => c.name === prefix);
    let sessionStr = single ? decodeURIComponent(single.value) : '';

    if (!sessionStr) {
      // Try chunked cookies: sb-{ref}-auth-token.0, .1, ...
      const chunks = cookies
        .filter(c => c.name.startsWith(prefix + '.'))
        .sort((a, b) => {
          const ai = parseInt(a.name.slice(prefix.length + 1));
          const bi = parseInt(b.name.slice(prefix.length + 1));
          return ai - bi;
        });
      if (chunks.length > 0) {
        sessionStr = chunks.map(c => decodeURIComponent(c.value)).join('');
      }
    }

    if (!sessionStr) return null;
    const session = JSON.parse(sessionStr) as {
      access_token?: string; refresh_token?: string;
      expires_at?: number; user?: { id: string; email: string };
    };
    if (!session.access_token || !session.user?.id) return null;
    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token ?? '',
      user_id: session.user.id,
      email: session.user.email ?? '',
      expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + 3600,
    };
  } catch {
    return null;
  }
}

// ── Layer 2: tabs.onUpdated — backup for URL token when onBeforeNavigate misses
chrome.tabs.onUpdated.addListener(async (_tabId, changeInfo, tab) => {
  const url = changeInfo.url ?? tab.url ?? '';
  if (!url.includes('proton.oli.cmu.edu')) return;

  // Try URL token (from oer_token query param)
  try {
    const parsed = new URL(url);
    const rawToken = parsed.searchParams.get('oer_token');
    if (rawToken) {
      const tokenAuth = JSON.parse(decodeURIComponent(atob(rawToken))) as StoredAuth;
      if (tokenAuth.access_token && tokenAuth.user_id) {
        const existingTokenAuth = (await chrome.storage.local.get('auth') as { auth?: StoredAuth }).auth;
        const stored = { ...tokenAuth, platformUrl: existingTokenAuth?.platformUrl };
        await chrome.storage.local.set({ auth: stored });
        return;
      }
    }
  } catch { /* fall through */ }

  // Fallback: read from production platform cookies, preserving any existing platformUrl.
  const existingTabAuth = (await chrome.storage.local.get('auth') as { auth?: StoredAuth }).auth;
  const cookieAuth = await readSessionFromCookies('https://annotation-platform-seven.vercel.app');
  if (cookieAuth) {
    const stored = { ...cookieAuth, platformUrl: existingTabAuth?.platformUrl };
    await chrome.storage.local.set({ auth: stored });
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

async function getStoredAuth(): Promise<StoredAuth | null> {
  const { auth } = await chrome.storage.local.get('auth') as { auth?: StoredAuth };
  if (!auth) return null;
  if (auth.expires_at < Math.floor(Date.now() / 1000) + 60) {
    return refreshToken(auth.refresh_token);
  }
  return auth;
}

async function login(email: string, password: string): Promise<BackgroundResponse<StoredAuth>> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json() as { error_description?: string; msg?: string };
      return { success: false, error: err.error_description ?? err.msg ?? 'Login failed' };
    }
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string };
    };
    const existingLoginAuth = (await chrome.storage.local.get('auth') as { auth?: StoredAuth }).auth;
    const auth: StoredAuth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: data.user.id,
      email: data.user.email,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      platformUrl: existingLoginAuth?.platformUrl,
    };
    await chrome.storage.local.set({ auth });
    return { success: true, data: auth };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

async function refreshToken(token: string): Promise<StoredAuth | null> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: token }),
    });
    if (!res.ok) { await chrome.storage.local.remove('auth'); return null; }
    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      user: { id: string; email: string };
    };
    const existingRefreshAuth = (await chrome.storage.local.get('auth') as { auth?: StoredAuth }).auth;
    const auth: StoredAuth = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      user_id: data.user.id,
      email: data.user.email,
      expires_at: Math.floor(Date.now() / 1000) + data.expires_in,
      platformUrl: existingRefreshAuth?.platformUrl,
    };
    await chrome.storage.local.set({ auth });
    return auth;
  } catch { return null; }
}

// ── Screenshot ────────────────────────────────────────────────────────────────

async function captureTab(windowId: number): Promise<BackgroundResponse<{ png: string }>> {
  try {
    const png = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    return { success: true, data: { png } };
  } catch (err) {
    console.error('[OER] captureTab failed:', err);
    return { success: false, error: (err as Error).message };
  }
}

async function uploadScreenshot(
  png: string,
  reviewId: string,
  accessToken: string,
): Promise<BackgroundResponse<{ url: string }>> {
  try {
    const filename = `${reviewId}/${Date.now()}.png`;
    const base64 = png.replace(/^data:image\/png;base64,/, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${SCREENSHOTS_BUCKET}/${filename}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'image/png',
      },
      body: bytes,
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[OER] uploadScreenshot failed:', res.status, text);
      return { success: false, error: text };
    }
    const url = `${SUPABASE_URL}/storage/v1/object/public/${SCREENSHOTS_BUCKET}/${filename}`;
    return { success: true, data: { url } };
  } catch (err) {
    console.error('[OER] uploadScreenshot threw:', err);
    return { success: false, error: (err as Error).message };
  }
}

// ── REST helpers ──────────────────────────────────────────────────────────────

function headers(token: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${token}`,
    ...extra,
  };
}

async function get<T>(path: string, token: string): Promise<BackgroundResponse<T>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers(token) });
  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true, data: await res.json() as T };
}

async function post<T>(path: string, body: unknown, token: string): Promise<BackgroundResponse<T>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: headers(token, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: await res.text() };
  const data = await res.json() as T[] | T;
  return { success: true, data: Array.isArray(data) ? data[0] : data };
}

async function patch<T>(path: string, body: unknown, token: string): Promise<BackgroundResponse<T>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: headers(token, { 'Prefer': 'return=representation' }),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true };
}

async function callRpc<T>(fn: string, body: unknown, token: string): Promise<BackgroundResponse<T>> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true };
}

async function del(path: string, token: string): Promise<BackgroundResponse> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'DELETE',
    headers: headers(token),
  });
  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true };
}

interface SaveScorePayload {
  review_id: string;
  rubric_item_id: string;
  score: CriterionScore | null;
  criterion_scores: CriterionScore[];
  comment?: string | null;
}

async function upsertScore(payload: SaveScorePayload, token: string): Promise<BackgroundResponse> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/review_scores?on_conflict=review_id,rubric_item_id`,
    {
      method: 'POST',
      headers: headers(token, { 'Prefer': 'return=representation,resolution=merge-duplicates' }),
      body: JSON.stringify(payload),
    }
  );
  if (!res.ok) return { success: false, error: await res.text() };
  return { success: true };
}

async function getAssignments(auth: StoredAuth): Promise<BackgroundResponse> {
  const resp = await get(
    `reviews?reviewer_id=eq.${auth.user_id}&status=in.(assigned,in_progress,submitted)&select=id,document_id,rubric_id,status,notes,updated_at,documents(title,source_url),rubrics(title)`,
    auth.access_token,
  );
  if (!resp.success) return resp;

  // Keep submitted rows only for documents that still have at least one
  // assigned/in_progress row. A document where every rubric is submitted is
  // intentionally complete — the extension should show no active assignment for
  // it, exactly as it did before submitted rows were included in the query.
  const rows = resp.data as Array<{ document_id: string; status: string }>;
  const activeDocIds = new Set(
    rows
      .filter(r => r.status === 'assigned' || r.status === 'in_progress')
      .map(r => r.document_id)
  );
  return { success: true, data: rows.filter(r => activeDocIds.has(r.document_id)) };
}

// Fetch a single review by id, regardless of status. getAssignments() excludes
// fully-submitted documents, so a deep link to a submitted review in a completed
// document would resolve to nothing and the console would silently open the wrong
// review. This lets routeToReview() honor the exact oer_review_id it was handed.
// Scoped to the reviewer's own rows via RLS + the reviewer_id filter, so it can
// only ever return a review the caller owns.
async function getReview(reviewId: string, auth: StoredAuth): Promise<BackgroundResponse> {
  const resp = await get(
    `reviews?id=eq.${reviewId}&reviewer_id=eq.${auth.user_id}&select=id,document_id,rubric_id,status,notes,updated_at,documents(title,source_url),rubrics(title)`,
    auth.access_token,
  );
  if (!resp.success) return resp;
  const rows = resp.data as unknown[];
  return { success: true, data: Array.isArray(rows) && rows.length > 0 ? rows[0] : null };
}

// Satisfy TypeScript — these types are used only via the payload union above
export type { Anchor, HighlightTag };
