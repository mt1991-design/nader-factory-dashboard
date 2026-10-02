/*
 * Nader Factory & Sales Dashboard — server
 * Serves the dashboard (index.html) and proxies read-only Shopify Admin data
 * so the storefront token is never exposed to the browser.
 *
 * Env vars (set in DigitalOcean App Platform → Settings → App-Level Env):
 *   SHOPIFY_STORE        e.g. 91fb05.myshopify.com
 *   SHOPIFY_TOKEN        Admin API token (needs read_orders + read_draft_orders)
 *   SHOPIFY_API_VERSION  e.g. 2025-01
 *   SESSION_SECRET       any long random string (signs the login cookie)
 *   SALES_PASSWORD       staff password for the Sales role
 *   FACTORY_PASSWORD     staff password for the Factory role
 */
const express = require('express');
const crypto  = require('crypto');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 8080;

const STORE   = process.env.SHOPIFY_STORE || '';
const TOKEN   = process.env.SHOPIFY_TOKEN || '';
const APIVER  = process.env.SHOPIFY_API_VERSION || '2025-01';
const SECRET  = process.env.SESSION_SECRET || 'change-me';

/* ---------- users (passwords stored as node-scrypt hashes; plaintext lives only with Mariam) ---------- */
const USERS = {
  mariam: { name: "Mariam", roles: ["sales", "factory", "admin"], salt: "87f829eef290e427ae24edb201eaf7c4", hash: "d9f49c61091ce7d825f5d274cce2f8e35c0eb925193ad4f1a01b2c459e96307c" },
  ali: { name: "Ali", roles: ["sales", "factory", "admin"], salt: "b481290fdbc8b57cbbc427f0d5d26a55", hash: "c9d043d74fcf14363db74df522ee5c45f4698b0506d11a390f160f81893bb159" },
  kamal: { name: "Kamal", roles: ["sales", "factory", "admin"], salt: "400818f25488fbfea0b8f7eb049f8133", hash: "46f100313d63d43eccf11a9dd5a42da4ccf011a4feacac4bf2cea69b855b6756" },
  /* generic "admin" login switched off 1 Oct 2026 (replaced by personal admin logins) */
  // admin: { name: "Admin", roles: ["sales", "factory", "admin"], salt: "52009a8101b9e4013040a20e6e08f105", hash: "4b55e70893e982a4e49d0a980dc80cd079fe1967c65d29e2565527fcbe8269fa" },
  mohammed: { name: "Mohammed", roles: ["sales"], salt: "dde948d96b635c2926863aa5516879bf", hash: "4361273ee51ee4e4f5dde4e61e77b1a0af3a2f2d9dd154bf27ffb3e83644bb4a" },
  abdul: { name: "Abdul", roles: ["sales", "factory"], salt: "12ec47476e4396b29e5c7f78b2dbc8fd", hash: "3feffd85233dcfff44cf07516386e145442ede8d8e8987eb9bf1fbe649a19d72" },
  zahak: { name: "Zahak", roles: ["sales"], salt: "66f2715a7c0fe3bc6c78890b3df37dba", hash: "8c06bec3f7dcfb41a87a395e7c32385e728ba2a88f7f49a12ede9196c88c5675" },
  adnan: { name: "Adnan", roles: ["sales"], salt: "c86ed9e0fa1404b6e4c79d9dafd04c8d", hash: "bce48af9049f4f1328048e3b7e764e53042e821c9f91f73185c2c7cb9a297e0c" },
  nizam: { name: "Nizam", roles: ["sales"], salt: "a08a275b45d6aad0c3e632cdb4123633", hash: "07248fd3a04274086b2b4dd47cd2d7dba648ee46da90d7ca281b9fc655cedd9b" },
  aslam: { name: "Mohammed Aslam", roles: ["sales", "factory"], salt: "aec9ab7d64cc471c7a5d4013d4a3f00a", hash: "0fefb6223fe8682accc278e5c06bda6acdeed5c5a8332b599c7cb2cec9aa56de" },
  sam: { name: "Sam", roles: ["sales", "factory"], salt: "2ede4da91610ea4721d4d1a8d9060e20", hash: "ce7b72b2bf918da150befd204441c989e76400bb288a4f496d3020fc3dbd772d" },
};
function checkPassword(user, password) {
  if (!user || !password) return false;
  try {
    const h = crypto.scryptSync(String(password), Buffer.from(user.salt, 'hex'), 32);
    return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
  } catch (e) { return false; }
}

app.use(express.json({ limit: '8mb' }));

/* ---------- gzip: JSON + HTML shrink ~5–8× over the wire (built-in zlib, no extra package) ---------- */
const zlib = require('zlib');
app.use((req, res, next) => {
  if (!/\bgzip\b/.test(req.headers['accept-encoding'] || '')) return next();
  const send = res.send.bind(res);
  res.send = function (body) {
    try {
      if ((typeof body === 'string' || Buffer.isBuffer(body)) && !res.getHeader('Content-Encoding')) {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
        if (buf.length > 2048) {
          if (!res.getHeader('Content-Type')) res.type(typeof body === 'string' ? 'html' : 'bin');
          res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding');
          return send(zlib.gzipSync(buf, { level: 6 }));
        }
      }
    } catch (e) { /* fall through uncompressed */ }
    return send(body);
  };
  next();
});
/* the pages themselves: gzip once, serve from memory */
const PAGE_GZ = {};
function servePage(file) {
  return (req, res, next) => {
    try {
      if (!PAGE_GZ[file]) { const raw = require('fs').readFileSync(path.join(__dirname, file)); PAGE_GZ[file] = { raw, gz: zlib.gzipSync(raw, { level: 9 }) }; }
      res.type('html'); res.setHeader('Cache-Control', 'no-cache');
      if (/\bgzip\b/.test(req.headers['accept-encoding'] || '')) { res.setHeader('Content-Encoding', 'gzip'); res.setHeader('Vary', 'Accept-Encoding'); return res.end(PAGE_GZ[file].gz); }
      return res.end(PAGE_GZ[file].raw);
    } catch (e) { next(); }
  };
}
app.get(['/', '/index.html'], servePage('index.html'));
app.get(['/spec', '/spec.html'], servePage('spec.html'));
/* customer order tracker — public page, embedded only in nader.ae/pages/track-order (unlisted: no links to it anywhere) */
/* the customer's drawing page (spec sheet in customer mode — opened from the link the team sends) */
app.get('/drawing', (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.setHeader('Cache-Control', 'no-cache'); next(); }, servePage('spec.html'));
app.get(['/track', '/track.html'], (req, res, next) => {
  res.setHeader('Content-Security-Policy', "frame-ancestors https://nader.ae https://www.nader.ae https://91fb05.myshopify.com https://*.myshopify.com https://*.shopifypreview.com https://admin.shopify.com");
  res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next();
}, servePage('track.html'));
app.get('/meshes.json', (req, res, next) => { res.setHeader('Cache-Control', 'public, max-age=86400'); next(); });   // spec sheets can carry a replaced reference photo
app.use(cookies);

/* ---------- tiny signed-cookie session (no external deps) ---------- */
function sign(sess) {
  const b64 = Buffer.from(JSON.stringify(sess)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${mac}`;
}
function verify(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [b64, mac] = tok.split('.');
  const expect = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
  if (!mac || mac.length !== expect.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  let sess;
  try { sess = JSON.parse(Buffer.from(b64, 'base64url').toString()); } catch (e) { return null; }
  if (!sess || !sess.e || Date.now() > Number(sess.e)) return null;
  return sess;   // { u:username, e:exp }
}
function cookies(req, res, next) {
  req.cookies = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) req.cookies[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  next();
}
function requireAuth(req, res, next) {
  const sess = verify(req.cookies.nfs_session);
  const user = sess && USERS[sess.u];
  if (!user) return res.status(401).json({ ok: false, error: 'auth' });
  req.session = { username: sess.u, name: user.name, roles: user.roles };
  next();
}
function hasRole(req, role) { return req.session && (req.session.roles || []).indexOf(role) >= 0; }
// price is hidden only for FACTORY-ONLY users (dual sales+factory staff keep prices in their sales view)
function factoryOnly(req) { return hasRole(req, 'factory') && !hasRole(req, 'sales') && !hasRole(req, 'admin'); }

const SESSION_TTL_SEC = 30 * 60;   // 30-minute idle timeout (renewed on activity)
function setSessionCookie(res, username) {
  const exp = Date.now() + SESSION_TTL_SEC * 1000;
  res.setHeader('Set-Cookie',
    `nfs_session=${sign({ u: username, e: exp })}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`);
}

app.post('/api/login', (req, res) => {
  const uname = String((req.body || {}).username || '').trim().toLowerCase();
  const password = (req.body || {}).password;
  const user = USERS[uname];
  if (!user || !checkPassword(user, password)) {
    logEvent(uname || '(unknown)', 'login_failed', { ip: clientIp(req) });
    return res.json({ ok: false });
  }
  setSessionCookie(res, uname);
  logEvent(uname, 'login', { ip: clientIp(req), name: user.name });
  res.json({ ok: true, username: uname, name: user.name, roles: user.roles });
});

// Restore an existing session on page load/refresh, and slide it forward 12h on use.
/* changes on every deploy — open dashboards compare it and reload themselves onto the new version */
const BUILD = String(Date.now());
app.get('/api/session', (req, res) => {
  const sess = verify(req.cookies.nfs_session);
  const user = sess && USERS[sess.u];
  if (!user) return res.json({ ok: false });
  setSessionCookie(res, sess.u);
  res.json({ ok: true, username: sess.u, name: user.name, roles: user.roles, build: BUILD });
});

app.post('/api/logout', (req, res) => {
  const sess = verify(req.cookies.nfs_session);
  if (sess && sess.u) logEvent(sess.u, 'logout', { ip: clientIp(req) });
  res.setHeader('Set-Cookie', 'nfs_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

/* ---------- audit log (in-memory buffer, persisted best-effort to Cloudflare KV via the worker) ---------- */
const WORKER_URL = 'https://nader-drafts.partner-e88.workers.dev';
const FORM_SECRET = process.env.FORM_SECRET || '';   // set in DO env; enables KV persistence
const AUDIT_MAX = 6000;
let EVENTS = [];
let auditDirty = false;

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
function logEvent(username, type, meta) {
  EVENTS.push({ t: Date.now(), u: username || '', type: type || 'event', meta: meta || {} });
  if (EVENTS.length > AUDIT_MAX) EVENTS = EVENTS.slice(-AUDIT_MAX);
  auditDirty = true;
}
async function loadAudit() {
  if (!FORM_SECRET) return;
  try {
    const r = await fetch(WORKER_URL + '/audit', { headers: { 'X-Form-Secret': FORM_SECRET } });
    const d = await r.json().catch(() => ({}));
    if (d && d.ok && Array.isArray(d.log)) EVENTS = d.log.slice(-AUDIT_MAX);
  } catch (e) { /* memory-only if worker unreachable */ }
}
async function flushAudit() {
  if (!auditDirty || !FORM_SECRET) return;
  auditDirty = false;
  try {
    await fetch(WORKER_URL + '/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Form-Secret': FORM_SECRET },
      body: JSON.stringify({ log: EVENTS })
    });
  } catch (e) { auditDirty = true; }
}
setInterval(flushAudit, 15000);
loadAudit();

// Client posts UI activity (tab views, clicks, actions) here.
app.post('/api/track', requireAuth, (req, res) => {
  const evs = Array.isArray((req.body || {}).events) ? req.body.events : [];
  evs.slice(0, 50).forEach(e => logEvent(req.session.username, String(e && e.type || 'click').slice(0, 40),
    Object.assign({ ip: clientIp(req) }, (e && e.meta) || {})));
  res.json({ ok: true });
});

// Admin-only: full audit log + per-user summary.
app.get('/api/audit', requireAuth, (req, res) => {
  if (!hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'admin only' });
  const users = {};
  for (const key of Object.keys(USERS)) users[key] = { name: USERS[key].name, roles: USERS[key].roles, lastLogin: 0, lastSeen: 0, logins: 0, events: 0 };
  EVENTS.forEach(e => {
    const u = users[e.u]; if (!u) return;
    u.events++;
    if (e.t > u.lastSeen) u.lastSeen = e.t;
    if (e.type === 'login') { u.logins++; if (e.t > u.lastLogin) u.lastLogin = e.t; }
  });
  res.json({ ok: true, users, events: EVENTS.slice(-2500) });
});

/* ---------- Shopify Admin proxy (full pagination + short cache) ---------- */
async function shopify(pathAndQuery, maxPages = 60) {
  if (!STORE || !TOKEN) throw new Error('Shopify not configured');
  let url = `https://${STORE}/admin/api/${APIVER}/${pathAndQuery}`;
  const out = [];
  let key = null;
  for (let page = 0; page < maxPages && url; page++) {
    const r = await fetch(url, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!r.ok) {
      const body = await r.text();
      const err = new Error(`Shopify ${r.status}`);
      err.status = r.status; err.body = body.slice(0, 300);
      throw err;
    }
    const data = await r.json();
    if (!key) key = Object.keys(data)[0];
    if (Array.isArray(data[key])) out.push(...data[key]);
    // pagination via Link header (rel="next")
    const link = r.headers.get('link') || '';
    const m = link.match(/<([^>]+)>;\s*rel="next"/);
    url = m ? m[1] : null;
  }
  return out;
}

// In-memory cache, served instantly and refreshed in the BACKGROUND (stale-while-revalidate) — nobody waits on
// Shopify except the very first request after a deploy. A timer also re-warms it every minute.
// ?fresh=1 (the Refresh button) waits for a fresh copy.
const CACHE = {};
const TTL = 60 * 1000;
function refresh(name, fetcher) {
  const h = CACHE[name] || (CACHE[name] = {});
  if (h.pending) return h.pending;
  h.pending = fetcher().then(data => { CACHE[name] = { at: Date.now(), data }; return data; })
    .finally(() => { if (CACHE[name]) CACHE[name].pending = null; });
  return h.pending;
}
async function cached(name, fetcher, fresh) {
  const hit = CACHE[name];
  if (hit && hit.data && !fresh) {
    if (Date.now() - hit.at > TTL) refresh(name, fetcher).catch(() => {});
    return hit.data;
  }
  /* Refresh button: don't settle for a fetch that started before the click (e.g. just after marking paid) */
  if (fresh && hit && hit.pending) await hit.pending.catch(() => {});
  return refresh(name, fetcher);
}
const byNewest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
const dedupe = arr => { const seen = new Set(); return arr.filter(o => !seen.has(o.id) && seen.add(o.id)); };
const ORDER_FIELDS = 'id,name,created_at,processed_at,financial_status,fulfillment_status,currency,total_price,subtotal_price,total_tax,customer,email,phone,shipping_address,billing_address,line_items,tags,note,fulfillments,cancelled_at,updated_at';
/* Only what the dashboard shows: orders not yet shipped + orders shipped in the last few days
   (was: every order ever placed, ~1,800, then filtered). */
const FETCH = {
  orders: async () => {
    const since = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const [open, shipped] = await Promise.all([
      shopify(`orders.json?status=any&fulfillment_status=unfulfilled&limit=250&fields=${ORDER_FIELDS}`),
      shopify(`orders.json?status=any&fulfillment_status=shipped&updated_at_min=${encodeURIComponent(since)}&limit=250&fields=${ORDER_FIELDS}`)
    ]);
    return dedupe(open.concat(shipped)).sort(byNewest);
  },
  /* KPI history: every order from the last 26 weeks (id/date/tags only) — weekly sparkline + lead time */
  stats: async () => {
    const since = new Date(Date.now() - 26 * 7 * 864e5).toISOString();
    return shopify(`orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250&fields=id,created_at,cancelled_at,tags`, 10);
  },
  /* Admin sales insights: every order from the last 13 months (paged; ~1,000 orders) */
  adminSales: async () => {
    const since = new Date(Date.now() - 400 * 864e5).toISOString();
    return shopify(`orders.json?status=any&created_at_min=${encodeURIComponent(since)}&limit=250&fields=id,name,created_at,total_price,current_total_price,financial_status,cancelled_at,cancel_reason,fulfillment_status,line_items,note,user_id,source_name,shipping_address`, 12);
  },
  /* completed drafts already appear as orders — only open / invoice-sent drafts are needed (was: all ~1,500) */
  drafts: async () => {
    const [open, sent] = await Promise.all([
      shopify('draft_orders.json?status=open&limit=250'),
      shopify('draft_orders.json?status=invoice_sent&limit=250')
    ]);
    return dedupe(open.concat(sent)).sort(byNewest);
  }
};
function warm() { Object.keys(FETCH).forEach(k => refresh(k, FETCH[k]).catch(() => {})); }
setTimeout(warm, 2000);
setInterval(warm, TTL);

function custName(c) {
  if (!c) return '';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '';
}
function mapLineItems(arr) {
  return (arr || []).map(li => ({
    product: li.title,
    variant: li.variant_title || '',
    sku: li.sku || '',
    qty: li.quantity || 1,
    price: li.price || ''
  }));
}
function extractPdf(note) {
  if (!note) return '';
  const m = String(note).match(/https?:\/\/\S+\/pdf\/[a-zA-Z0-9]+/);
  return m ? m[0] : '';
}
// Production timeline stored on the order as a tag `prodstage:N` (0=Drawing … 4=Packing, 5=Stored in warehouse, 6=Delivery booked). Shared + persistent.
const PROD_STAGE_COUNT = 7;
const clampStage = n => Math.max(0, Math.min(PROD_STAGE_COUNT - 1, parseInt(n, 10) || 0));
// Who worked on each production stage of each line: tags `crew:<line>:<stage>:<Name>@<yyyy-mm-dd>` (stage 0 Drawing … 4 Packing).
// Several people can share a stage (one tag each) → crew[line][stage] = [{n,d}, …]
function crewFromTags(tags) {
  const out = {};
  String(tags || '').split(',').map(t => t.trim()).forEach(t => {
    const m = t.match(/^crew:(\d+):(\d):(.+?)@(\d{4}-\d{2}-\d{2})$/);
    if (m) { const L = out[m[1]] = out[m[1]] || {}; (L[m[2]] = L[m[2]] || []).push({ n: m[3], d: m[4] }); }
  });
  return out;
}
// Delivered (the team confirmed the handover), per line: tag `delivered:<line>@<yyyy-mm-dd>`; `shopfulfilled:<line>` once Shopify has it
function deliveredFromTags(tags) {
  const out = {};
  String(tags || '').split(',').map(t => t.trim()).forEach(t => {
    let m = t.match(/^delivered:(\d+)@(\d{4}-\d{2}-\d{2})$/); if (m) { (out[m[1]] = out[m[1]] || {}).d = m[2]; return; }
    m = t.match(/^shopfulfilled:(\d+)$/); if (m) (out[m[1]] = out[m[1]] || {}).f = true;
  });
  return out;
}
// Delivery booked with the customer, per line: tag `delivery:<line>:<yyyy-mm-ddThh:mm>` (UAE time)
function deliveryFromTags(tags) {
  const out = {};
  String(tags || '').split(',').map(t => t.trim()).forEach(t => {
    const m = t.match(/^delivery:(\d+):(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/);
    if (m) out[m[1]] = m[2];
  });
  return out;
}
// When each line reached each stage: tags `pd:<line>:<stage>@<yyyy-mm-ddThh:mm>` (UAE time). Feeds lead time, days-in-stage and Today.
function stageDatesFromTags(tags) {
  const out = {};
  String(tags || '').split(',').map(t => t.trim()).forEach(t => {
    const m = t.match(/^pd:(\d+):(\d)@(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/);
    if (m) { (out[m[1]] = out[m[1]] || {})[m[2]] = m[3]; }
  });
  return out;
}
const uaeNow = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 16);   // UAE = UTC+4, no DST
// Lead time promised to the customer: read from the order note ("30–40 working days", "31 working days"),
// otherwise the website's standard 7–21 working days. Working days = Mon–Fri, counted from the order date
// (recomputed on every request, so the "past the promise window" list updates itself daily).
function workingDaysSince(iso) {
  const start = new Date(String(iso).slice(0, 10) + 'T00:00:00+04:00'), now = new Date(Date.now() + 4 * 3600e3);
  let n = 0; const d = new Date(start.getTime());
  while (true) { d.setUTCDate(d.getUTCDate() + 1); if (d > now) break; const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) n++; }
  return n;
}
function promiseOf(o) {
  const note = String(o.note || '');
  let m = note.match(/(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\s*(?:working|business)?\s*days?/i), lo, hi, src = 'note';
  if (m) { lo = +m[1]; hi = +m[2]; }
  else if ((m = note.match(/(\d{1,3})\s*(?:working|business)\s*days/i))) { lo = hi = +m[1]; }
  else { lo = 7; hi = 21; src = 'standard'; }
  const wd = workingDaysSince(o.created_at || '');
  return { lo, hi, src, wd, over: wd - hi };
}
// Average lead time (order placed → packing reached), only from lines the factory actually timed on the dashboard.
// Stays hidden until there are ≥5 finished lines AND ≥3 weeks since the first timed stage, so it's based on real data.
function leadTime(raw) {
  let first = null; const days = [];
  raw.forEach(o => {
    const pd = stageDatesFromTags(o.tags);
    Object.keys(pd).forEach(line => {
      Object.values(pd[line]).forEach(d => { if (!first || d < first) first = d; });
      const packed = pd[line]['4'];
      if (packed && o.created_at) days.push((Date.parse(packed + ':00+04:00') - Date.parse(o.created_at)) / 864e5);
    });
  });
  const weeks = first ? (Date.now() - Date.parse(first + ':00+04:00')) / (7 * 864e5) : 0;
  const ready = days.length >= 5 && weeks >= 3;
  return { ready, n: days.length, since: first ? first.slice(0, 10) : '', weeks: Math.floor(weeks),
    avg: ready ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null };
}
// Orders placed per week for the last 12 weeks (oldest first, current week last) — the KPI sparkline.
function weeklyOrders(raw) {
  const wk = new Array(12).fill(0), now = Date.now();
  raw.forEach(o => { if (o.cancelled_at || !o.created_at) return;
    const w = Math.floor((now - Date.parse(o.created_at)) / (7 * 864e5)); if (w >= 0 && w < 12) wk[11 - w]++; });
  return wk;
}
// Per-line-item production stage, stored on the order as tags `prodstage:<lineIndex>:<stage>`.
// (legacy `prodstage:<stage>` = whole-order, applied to every line for backward-compat)
function prodStagesFromTags(tags, nLines) {
  const arr = new Array(Math.max(1, nLines || 1)).fill(0);
  let legacy = null;
  String(tags || '').split(',').map(t => t.trim()).forEach(t => {
    let m = t.match(/^prodstage:(\d+):(\d+)$/);
    if (m) { const li = +m[1]; if (li < arr.length) arr[li] = clampStage(m[2]); return; }
    m = t.match(/^prodstage:(\d+)$/);
    if (m) legacy = clampStage(m[1]);
  });
  if (legacy != null) for (let i = 0; i < arr.length; i++) arr[i] = legacy;
  return arr;
}
// Strip all pricing from an order/draft before sending to the factory role.
function stripPrice(o) {
  const c = Object.assign({}, o);
  delete c.total; delete c.subtotal; delete c.tax; delete c.currency; delete c.financial_status;
  c.items = (c.items || []).map(it => { const x = Object.assign({}, it); delete x.price; return x; });
  if (c.note) c.note = c.note.split('\n').filter(l => !/\bAED\b|total/i.test(l)).join('\n').replace(/\n{3,}/g, '\n\n');
  return c;
}
function mapAddress(a) {
  if (!a) return null;
  return {
    name: a.name || [a.first_name, a.last_name].filter(Boolean).join(' '),
    company: a.company || '',
    address1: a.address1 || '', address2: a.address2 || '',
    city: a.city || '', province: a.province || '', zip: a.zip || '',
    country: a.country || '', phone: a.phone || ''
  };
}

/* ---------- DRAWING APPROVAL (manual): the team checks the drawing, presses Send; the customer approves or asks for a change ----------
   Status per order line lives in the worker doc "drawings" under "<orderId>:<line>":
   { sent:{t,by,n}, approved:{t,name}, changes:[{t,text}], edit:{t,by,reason,done?} }. Approval also tags the Shopify order drawok:<line>@<date>.
   The customer link carries an HMAC token (order id + line) — nothing else can be guessed from it. */
let DRAWST = null, DRAWST_AT = 0, drawQ = Promise.resolve();
async function drawDoc(fresh) {
  if (!fresh && DRAWST && Date.now() - DRAWST_AT < 15000) return DRAWST;
  const d = await workerJson('/doc/drawings'); if (d && d.ok) { DRAWST = d.data || {}; DRAWST_AT = Date.now(); }
  return DRAWST || {};
}
function drawUpdate(key, fn) {
  const run = drawQ.then(async () => {
    const all = JSON.parse(JSON.stringify(await drawDoc(true)));
    all[key] = fn(all[key] || {}) || all[key];
    const out = await docSet('drawings', all); if (!out || !out.ok) throw new Error('save failed');
    DRAWST = all; DRAWST_AT = Date.now(); return all[key];
  });
  drawQ = run.catch(() => {}); return run;
}
const drawToken = (id, line, test) => { const b = Buffer.from(id + '.' + line + (test ? '.t' : '')).toString('base64url');
  return b + '.' + crypto.createHmac('sha256', SECRET).update('draw:' + b).digest('base64url').slice(0, 22); };
function drawParse(t) {
  const [b, mac] = String(t || '').split('.'); if (!b || !mac) return null;
  const want = crypto.createHmac('sha256', SECRET).update('draw:' + b).digest('base64url').slice(0, 22);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const [id, line, tf] = Buffer.from(b, 'base64url').toString().split('.'); return /^\d+$/.test(id) ? { id, line: parseInt(line, 10) || 0, test: tf === 't' } : null;
}
async function drawOrder(id) {
  let o = (await cached('orders', FETCH.orders, false)).find(x => String(x.id) === String(id));
  if (!o) { const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,name,line_items,tags,cancelled_at`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (r.ok) o = (await r.json()).order; }
  return o;
}
const drawSpecId = (o, line) => String(o.name || '').replace(/\D/g, '') + ((o.line_items || []).length > 1 ? '-' + (line + 1) : '');
async function tagOrder(id, add, dropPrefix) {
  const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,tags`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
  if (!r.ok) throw new Error('Shopify ' + r.status);
  let tags = (((await r.json()).order || {}).tags || '').split(',').map(t => t.trim()).filter(t => t && !(dropPrefix && t.startsWith(dropPrefix)));
  if (add) tags.push(add);
  const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, { method: 'PUT',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } }) });
  if (!up.ok) throw new Error('Shopify PUT ' + up.status);
  if (CACHE.orders) delete CACHE.orders;
}
/* team: send the drawing to the customer (after checking the PDF) — returns the customer's link */
app.post('/api/drawing/send', requireAuth, async (req, res) => {
  const b = req.body || {}, id = String(b.id || '').replace(/\D/g, ''), line = Math.max(0, parseInt(b.line, 10) || 0);
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try {
    const who = req.session.name || req.session.username;
    const link = `https://${req.headers.host}/drawing?t=${drawToken(id, line)}`;
    const rec = await drawUpdate(id + ':' + line, r => { r.sent = { t: uaeNow(), by: who, n: ((r.sent || {}).n || 0) + 1, link }; if (r.edit) r.edit.done = r.edit.done || { t: uaeNow(), by: who }; return r; });
    logEvent(req.session.username, 'drawing_sent', { id, line, ip: clientIp(req) });
    res.json({ ok: true, rec, link });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
/* admin: a TEST link for any order line — the page works, but approving / requesting a change saves nothing */
app.post('/api/drawing/test-link', requireAuth, (req, res) => {
  if (!hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'admin only' });
  const b = req.body || {}, id = String(b.id || '').replace(/\D/g, ''), line = Math.max(0, parseInt(b.line, 10) || 0);
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  res.json({ ok: true, link: `https://${req.headers.host}/drawing?t=${drawToken(id, line, true)}` });
});
/* team: the drawing is wrong → ask an admin to edit it (or an admin marks it fixed) */
app.post('/api/drawing/edit-request', requireAuth, async (req, res) => {
  const b = req.body || {}, line = Math.max(0, parseInt(b.line, 10) || 0);
  let id = String(b.id || '').replace(/\D/g, '');
  if (!id && b.order) {   /* from the spec sheet: it knows the order number, not the Shopify id */
    const num = String(b.order).replace(/\D/g, ''); try { const o = (await cached('orders', FETCH.orders, false)).find(x => String(x.name || '').replace(/\D/g, '') === num.slice(0, 8) || String(x.name || '').replace(/\D/g, '') === num); if (o) id = String(o.id); } catch (e) {}
  }
  if (!id) return res.status(400).json({ ok: false, error: 'order not found' });
  try {
    const who = req.session.name || req.session.username;
    const rec = await drawUpdate(id + ':' + line, r => {
      if (b.done) { if (r.edit) r.edit.done = { t: uaeNow(), by: who }; }
      else r.edit = { t: uaeNow(), by: who, reason: String(b.reason || '').trim().slice(0, 1000) };
      return r; });
    logEvent(req.session.username, b.done ? 'drawing_edit_done' : 'drawing_edit_request', { id, line, ip: clientIp(req) });
    res.json({ ok: true, rec });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});
/* customer: open the drawing (public, token only) */
const DRAW_HITS = new Map();
function drawLimit(req) { const ip = clientIp(req), now = Date.now(), h = (DRAW_HITS.get(ip) || []).filter(t => now - t < 10 * 60e3);
  h.push(now); DRAW_HITS.set(ip, h); if (DRAW_HITS.size > 5000) DRAW_HITS.clear(); return h.length > 40; }
app.get('/api/drawing', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (drawLimit(req)) return res.status(429).json({ ok: false, error: 'busy' });
  const k = drawParse(req.query.t); if (!k) return res.status(404).json({ ok: false, error: 'notfound' });
  try {
    const o = await drawOrder(k.id); if (!o || o.cancelled_at) return res.status(404).json({ ok: false, error: 'notfound' });
    const st = k.test ? {} : ((await drawDoc(false))[k.id + ':' + k.line] || {});
    if (!st.sent && !k.test) return res.status(404).json({ ok: false, error: 'notfound' });
    const sp = await workerJson('/spec/' + drawSpecId(o, k.line));
    if (!sp || !sp.data) return res.status(404).json({ ok: false, error: 'notfound' });
    /* the customer never gets the team's internal notes, the agent or who drew / locked it */
    const data = Object.assign({}, sp.data); delete data.notes; delete data.unlockReq; delete data.locked; delete data.completedBy; delete data.unlockedBy;
    if (data.cust) data.cust = Object.assign({}, data.cust, { agent: '', showroom: '' });
    res.json({ ok: true, order: o.name, data, test: !!k.test, status: { approved: st.approved || null, changes: st.changes || [] } });
  } catch (e) { res.status(502).json({ ok: false, error: 'unavailable' }); }
});
app.post('/api/drawing/approve', async (req, res) => {
  if (drawLimit(req)) return res.status(429).json({ ok: false, error: 'busy' });
  const b = req.body || {}, k = drawParse(b.t); if (!k) return res.status(404).json({ ok: false, error: 'notfound' });
  if (!b.agree) return res.status(400).json({ ok: false, error: 'tick the box to confirm' });
  if (k.test) return res.json({ ok: true, test: true, approved: { t: uaeNow(), name: String(b.name || '').trim().slice(0, 80) } });   /* test link: nothing saved */
  try {
    const st = (await drawDoc(true))[k.id + ':' + k.line] || {}; if (!st.sent) return res.status(404).json({ ok: false, error: 'notfound' });
    const day = uaeNow().slice(0, 10), name = String(b.name || '').trim().slice(0, 80);
    const rec = await drawUpdate(k.id + ':' + k.line, r => { r.approved = { t: uaeNow(), name }; return r; });
    try { await tagOrder(k.id, 'drawok:' + k.line + '@' + day, 'drawok:' + k.line + '@'); } catch (e) {}
    logEvent('customer', 'drawing_approved', { id: k.id, line: k.line, name, ip: clientIp(req) });
    res.json({ ok: true, approved: rec.approved });
  } catch (e) { res.status(500).json({ ok: false, error: 'unavailable' }); }
});
app.post('/api/drawing/change', async (req, res) => {
  if (drawLimit(req)) return res.status(429).json({ ok: false, error: 'busy' });
  const b = req.body || {}, k = drawParse(b.t); if (!k) return res.status(404).json({ ok: false, error: 'notfound' });
  const text = String(b.text || '').trim().slice(0, 1500); if (!text) return res.status(400).json({ ok: false, error: 'empty' });
  if (k.test) return res.json({ ok: true, test: true, changes: [{ t: uaeNow(), text }] });   /* test link: nothing saved */
  try {
    const st = (await drawDoc(true))[k.id + ':' + k.line] || {}; if (!st.sent) return res.status(404).json({ ok: false, error: 'notfound' });
    const rec = await drawUpdate(k.id + ':' + k.line, r => { (r.changes = r.changes || []).push({ t: uaeNow(), text }); delete r.approved; return r; });
    try { await tagOrder(k.id, '', 'drawok:' + k.line + '@'); } catch (e) {}
    logEvent('customer', 'drawing_change_request', { id: k.id, line: k.line, ip: clientIp(req) });
    res.json({ ok: true, changes: rec.changes });
  } catch (e) { res.status(500).json({ ok: false, error: 'unavailable' }); }
});

/* ---------- PUBLIC order tracker for nader.ae/pages/track-order ----------
   The customer must give BOTH the order number AND the phone number on the order (last 9 digits must match);
   a wrong pair gets the same "not found" answer as a missing order. Only production progress is returned —
   never names, addresses, prices or notes. Attempts are limited per IP. */
const TRACK_ORIGINS = ['https://nader.ae', 'https://www.nader.ae', 'https://91fb05.myshopify.com'];
const TRACK_HITS = new Map();
const TRACK_COLORS = ['#b09a80', '#cdbfa8', '#9c8f80', '#8a7766', '#b0875a', '#6f5646', '#c3a099', '#8f9a7e', '#6c7682'];   // sand, oat, mushroom, taupe, camel, mocha, dusty rose, sage, slate
const last9 = p => String(p || '').replace(/\D/g, '').slice(-9);
/* which order lines are real pieces (old orders were typed straight into Shopify, so notes, fabrics, seat-depth upgrades,
   payments and cushion bundles often sit in their own lines). Checked against all 199 open orders, 1 Oct. */
const NOT_A_PIECE = /total\s*amount|deposit|balance|discount|already\s*paid|pending|delivery\s*(fee|charge)|installation|assembly\s*fee|^\s*aed\b|payment|^\s*(extra\s+)?fabric\b|^\s*shipping|^\s*custom\s*(fee|charge)|visit\s*fee/i;
const NOTE_START = /^\s*(seat\s*(depth|filling|dimension|width|height)|back\s*(rest|cushion)s?|backrest|sofa\s*(filling|seats|softness|size|to\s*be)|filling|fabric|upholstery|uplostry|upholstry|mattress\s*size|all\s+back|small\s+cushions|make\s+the|corner\s*piece|chaise\s+needs|arm\s*rests?|armrest|base\s*height|left\s+seat|middle\s+seat|right\s+seat|colou?r|size|real\s+leather|linen|leather\s+for|totop|tabletop:)/i;
const EARLY_NOTE = /^\s*(\S+\s+){0,3}(should|will|ready|please|needs?|must|make\s+sure|swatch\w*|samples?)\b/i;
const CUSHIONS_ONLY = /^\s*(total\s+)?\d+\s*(x\s*)?(saqure|square|round|small|big|extra)?\s*cushions?\b/i;
const FURN_WORD = /sofa|couch|sectional|chaise|corner|\bbeds?\b|headboard|daybed|chair|stool|table|bench|ottoman|pouf|puff|console|sideboard|cabinet|desk|bedside|nightstand|mirror|recliner|lounger|modular|seater|wardrobe|dresser|tv\s*unit|shelf/i;
function isPiece(li) {
  const t = String(li.title || '');
  if (NOT_A_PIECE.test(t) || NOTE_START.test(t) || CUSHIONS_ONLY.test(t)) return false;
  if (FURN_WORD.test(t) && parseFloat(li.price || 0) > 0) return true;   // priced furniture always counts
  if (EARLY_NOTE.test(t)) return false;
  return FURN_WORD.test(t) || !!li.product_id;
}
function trackType(t) {
  t = String(t || '').toLowerCase();
  if (/sofa\s*bed|day\s*-?bed/.test(t)) return 'sofa';
  if (/\b(bed|headboard)s?\b/.test(t)) return 'bed';
  if (/\b(bar|counter)\s*stool|\bstools?\b/.test(t)) return 'stool';
  if (/\btables?\b/.test(t)) return 'table';
  if (/arm\s*chair|accent\s*chair|lounge\s*chair|recliner/.test(t)) return 'armchair';
  if (/\bchairs?\b/.test(t)) return 'chair';
  return 'sofa';
}
const trackName = t => String(t || '').split(/\s+[-–|]\s+|\s*\|\s*|\s+size\b|:|\s\d{2,3}\s*[x×]/i)[0].trim().slice(0, 48) || 'Your piece';
function addWorkDays(iso, n) {
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z'); let k = 0;
  while (k < n) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) k++; }
  return d.toISOString().slice(0, 10);
}
/* dashboard → customer step (same rules as the tracker): time only moves a piece on WITHIN the dashboard stage it's in */
function trackStep(stage, since, drawn, fabricIn, delivered) {
  const SPLIT = 4, d = since ? workingDaysSince(since) : 0, half = since ? addWorkDays(since, SPLIT) : '';
  if (delivered) return { step: 13, since: delivered };
  switch (stage) {
    case 6: return { step: 12, since };
    case 5: return { step: 11, since };
    case 4: return d < 1 ? { step: 9, since } : { step: 10, since: addWorkDays(since, 1) };
    case 3: return d < SPLIT ? { step: 7, since } : { step: 8, since: half };
    case 2: return d < SPLIT ? { step: 5, since } : { step: 6, since: half };
    case 1: return { step: 4, since };
    default:
      if (!drawn) return { step: 0, since };
      if (fabricIn) return { step: 3, since: fabricIn };
      return workingDaysSince(drawn) < SPLIT ? { step: 1, since: drawn } : { step: 2, since: addWorkDays(drawn, SPLIT) };
  }
}
app.options('/api/order-status', (req, res) => {
  const o = req.headers.origin; if (TRACK_ORIGINS.includes(o)) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'POST'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.status(204).end();
});
app.post('/api/order-status', express.text({ type: '*/*', limit: '2kb' }), async (req, res) => {
  const origin = req.headers.origin; if (TRACK_ORIGINS.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Cache-Control', 'no-store');
  const ip = clientIp(req), now = Date.now(), hits = (TRACK_HITS.get(ip) || []).filter(t => now - t < 15 * 60e3);
  if (hits.length >= 12) return res.status(429).json({ ok: false, error: 'busy' });
  hits.push(now); TRACK_HITS.set(ip, hits);
  if (TRACK_HITS.size > 5000) TRACK_HITS.clear();
  let b = {}; try { b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) {}
  const num = String(b.order || '').replace(/\D/g, ''), ph = last9(b.phone);
  const notFound = () => res.json({ ok: false, error: 'notfound' });
  if (!num || num.length < 4 || ph.length < 8) return notFound();
  try {
    let o = (await cached('orders', FETCH.orders, false)).find(x => String(x.name || '').replace(/\D/g, '') === num);
    if (!o) { const r = await shopify(`orders.json?status=any&name=${encodeURIComponent('#' + num)}&fields=${ORDER_FIELDS}`, 1); o = r.find(x => String(x.name || '').replace(/\D/g, '') === num); }
    if (!o || o.cancelled_at) return notFound();
    const fin = (o.financial_status || '').toLowerCase(); if (fin === 'refunded' || fin === 'voided') return notFound();
    const phones = [o.phone, o.customer && o.customer.phone, o.shipping_address && o.shipping_address.phone, o.billing_address && o.billing_address.phone].map(last9).filter(x => x.length >= 8);
    if (!phones.includes(ph)) { logEvent('public', 'track_miss', { order: num, ip }); return notFound(); }
    const tags = o.tags || '', lis = o.line_items || [], stages = prodStagesFromTags(tags, lis.length), pd = stageDatesFromTags(tags),
      dlv = deliveredFromTags(tags), booked = deliveryFromTags(tags), created = (o.created_at || '').slice(0, 10), shipped = o.fulfillment_status === 'fulfilled';
    let fab = {}; try { fab = await fabricIndex(false); } catch (e) {}
    let specs = {}; try { ((await workerJson('/spec')).items || []).forEach(x => { specs[x.id] = x; }); } catch (e) {}
    const items = [];
    lis.forEach((li, i) => {
      if (!isPiece(li)) return;
      const st = stages[i] || 0, since = ((pd[i] || {})[st] || '').slice(0, 10) || created;
      const sp = specs[num + (lis.length > 1 ? '-' + (i + 1) : '')], drawn = sp && sp.status === 'complete' ? new Date(sp.at + 4 * 3600e3).toISOString().slice(0, 10) : '';
      const f = fab[o.id + ':' + i] || {}, delivered = (dlv[i] && dlv[i].d) || (shipped ? ((o.fulfillments || []).map(x => x.created_at).filter(Boolean).sort().pop() || '').slice(0, 10) : '');
      const s = trackStep(st, since, drawn, (f.delivered || '').slice(0, 10), delivered);
      const h = [...String(o.id) + i].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
      items.push({ name: trackName(li.title) + ((li.quantity || 1) > 1 ? ' ×' + li.quantity : ''), type: trackType(li.title), color: TRACK_COLORS[h % TRACK_COLORS.length],
        step: s.step, since: s.since || '', booked: booked[i] || '' });
    });
    if (!items.length && lis.length) {   /* nothing reads like a piece (e.g. a seat-depth change order): show the order as a whole */
      const st = stages[0] || 0, since = ((pd[0] || {})[st] || '').slice(0, 10) || created, s0 = trackStep(st, since, '', '', (dlv[0] && dlv[0].d) || '');
      items.push({ name: 'Your order', type: 'sofa', color: TRACK_COLORS[0], step: s0.step, since: s0.since || '', booked: booked[0] || '' }); }
    if (!items.length) return notFound();
    const pr = promiseOf(o), st = items.map(x => x.step), lo = Math.min.apply(null, st), hi = Math.max.apply(null, st);
    const shown = lo >= 10 ? lo : Math.min(hi, 9), slow = shown;   /* the stage the customer sees (same rule as the tracker) */
    logEvent('public', 'track_ok', { order: num, ip });
    res.json({ ok: true, order: o.name, items, late: pr.over > 0 && slow < 11, overdue: pr.over > 0,   /* stored+: no delay message, but overdue keeps 'Being confirmed' */
      window: { from: addWorkDays(created, pr.lo), to: addWorkDays(created, pr.hi) }, today: uaeNow().slice(0, 10) });
  } catch (e) { res.status(502).json({ ok: false, error: 'unavailable' }); }
});

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const fresh = req.query.fresh === '1';
    const raw = await cached('orders', FETCH.orders, fresh);
    // Limit what the sales team sees: hide refunded/voided/cancelled orders entirely,
    // and hide shipped orders more than 3 days after they shipped. Owners use Shopify for the full history.
    const nowMs = Date.now(), THREE_DAYS = 3 * 24 * 3600 * 1000;
    const orderState = (o) => {
      const fin = (o.financial_status || '').toLowerCase();
      if (o.cancelled_at || fin === 'refunded' || fin === 'voided' || fin === 'partially_refunded') return 'refunded';
      if ((o.fulfillment_status || '') === 'fulfilled') return 'shipped';
      return 'open';   // an order only exists if it's paid, so open == paid == "in production"
    };
    const terminalMs = (o, st) => {
      if (st === 'shipped') { const fd = (o.fulfillments || []).map(f => f.created_at).filter(Boolean).sort(); return Date.parse(fd.length ? fd[fd.length - 1] : o.updated_at) || 0; }
      if (st === 'refunded') { return Date.parse(o.cancelled_at || o.updated_at) || 0; }
      return nowMs;
    };
    // Open orders always show. Shipped & refunded only show for 3 days after the event, then roll off
    // automatically (the window is relative to "now", so each day the oldest drop out — no cleanup job needed).
    // Open orders always show; shipped shows for 3 days then rolls off; refunded/voided/cancelled are hidden entirely.
    const visible = raw.filter(o => { const st = orderState(o); if (st === 'refunded') return false; return st === 'open' || (nowMs - terminalMs(o, st)) <= THREE_DAYS; });
    const orders = visible.map(o => ({
      id: o.id,
      order: o.name,
      kind: 'order',
      customer: custName(o.customer),
      email: (o.customer && o.customer.email) || o.email || '',
      phone: (o.customer && o.customer.phone) || o.phone || (o.shipping_address && o.shipping_address.phone) || '',
      date: (o.created_at || '').slice(0, 10),
      financial_status: o.financial_status || '',
      fulfillment_status: o.fulfillment_status || 'unfulfilled',
      currency: o.currency || '',
      total: o.total_price || '',
      subtotal: o.subtotal_price || '',
      tax: o.total_tax || '',
      tags: o.tags || '',
      note: o.note || '',
      pdf_url: extractPdf(o.note),
      edit_state: (String(o.tags || '').match(/state:(s_[a-z0-9]+)/i) || [])[1] || '',
      shipping_address: mapAddress(o.shipping_address),
      billing_address: mapAddress(o.billing_address),
      admin_url: `https://${STORE}/admin/orders/${o.id}`,
      crew: crewFromTags(o.tags),
      prod_stages: prodStagesFromTags(o.tags, (o.line_items || []).length),
      prod_dates: stageDatesFromTags(o.tags),
      delivery: deliveryFromTags(o.tags),
      delivered: deliveredFromTags(o.tags),
      promise: promiseOf(o),
      prod_stage: Math.min.apply(null, prodStagesFromTags(o.tags, (o.line_items || []).length)),  // order-level = least-advanced line
      state: orderState(o),   // open | shipped | refunded  (safe to expose to factory — not price)
      items: mapLineItems(o.line_items)
    }));
    const out = factoryOnly(req) ? orders.map(stripPrice) : orders;
    let stats = raw; try { stats = await cached('stats', FETCH.stats, false); } catch (e) {}
    let fab = {}; try { fab = await fabricIndex(false); } catch (e) {}
    out.forEach(o => { const f = {}; (o.items || []).forEach((it, i) => { const r = fab[o.id + ':' + i]; if (r) f[i] = r; }); o.fabric = f; });
    let nts = {}; try { nts = await notesDoc(false); } catch (e) {}
    out.forEach(o => { o.tnotes = nts[o.id] || []; });
    let dst = {}; try { dst = await drawDoc(false); } catch (e) {}
    out.forEach(o => { const m = {}; (o.items || []).forEach((it, i) => { if (dst[o.id + ':' + i]) m[i] = dst[o.id + ':' + i]; }); o.drawst = m; });
    res.json({ ok: true, orders: out, lead: leadTime(stats), weekly: weeklyOrders(stats) });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

app.get('/api/draft_orders', requireAuth, async (req, res) => {
  try {
    const fresh = req.query.fresh === '1';
    const raw = await cached('drafts', FETCH.drafts, fresh);
    const drafts = raw.map(d => ({
      id: d.id,
      order: d.name,
      kind: 'draft',
      customer: custName(d.customer),
      email: (d.customer && d.customer.email) || d.email || '',
      phone: (d.customer && d.customer.phone) || (d.shipping_address && d.shipping_address.phone) || '',
      date: (d.created_at || '').slice(0, 10),
      status: d.status || 'open',        // open | invoice_sent | completed
      currency: d.currency || '',
      total: d.total_price || '',
      subtotal: d.subtotal_price || '',
      tax: d.total_tax || '',
      tags: d.tags || '',
      note: d.note || '',
      pdf_url: extractPdf(d.note),
      signature: /signature:signed/.test(d.tags || '') ? 'signed' : (/signature:pending/.test(d.tags || '') ? 'pending' : ''),
      payment_method: /payment-cash/.test(d.tags || '') ? 'cash' : (/payment-bank-transfer/.test(d.tags || '') ? 'transfer' : (/payment-card/.test(d.tags || '') ? 'card' : '')),
      edit_state: (String(d.tags || '').match(/state:(s_[a-z0-9]+)/i) || [])[1] || '',
      invoice_url: d.invoice_url || '',
      shipping_address: mapAddress(d.shipping_address),
      billing_address: mapAddress(d.billing_address),
      admin_url: `https://${STORE}/admin/draft_orders/${d.id}`,
      items: mapLineItems(d.line_items)
    }));
    const out = factoryOnly(req) ? drafts.map(stripPrice) : drafts;
    { let nts = {}; try { nts = await notesDoc(false); } catch (e) {} out.forEach(o => { o.tnotes = nts[o.id] || []; }); }
    res.json({ ok: true, drafts: out });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

// Factory advances the production timeline; stored as a `prodstage:N` tag on the order (persistent + visible in Shopify).
app.post('/api/production', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory')) return res.status(403).json({ ok: false, error: 'factory only' });
  const { id, stage } = req.body || {};
  const line = Math.max(0, parseInt((req.body || {}).line, 10) || 0);
  const s = clampStage(stage);
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try {
    const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,tags`,
      { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!r.ok) throw new Error('Shopify ' + r.status);
    const cur = ((await r.json()).order || {}).tags || '';
    // keep other tags; drop this line's old stage + any legacy whole-order stage.
    // Stage dates for this line: keep those below the new stage (and the new stage's own date if already set),
    // drop any above it (the line was moved back), then date the new stage if it has no date yet.
    const pdStage = t => { const m = t.match(/^pd:(\d+):(\d)@/); return m && +m[1] === line ? +m[2] : null; };
    const tags = cur.split(',').map(t => t.trim()).filter(t => {
      if (!t || new RegExp('^prodstage:' + line + ':').test(t) || /^prodstage:\d+$/.test(t)) return false;
      const ps = pdStage(t); return ps == null || ps <= s;
    });
    tags.push('prodstage:' + line + ':' + s);
    if (s > 0 && !tags.some(t => pdStage(t) === s)) tags.push('pd:' + line + ':' + s + '@' + uaeNow());
    const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } })
    });
    if (!up.ok) throw new Error('Shopify PUT ' + up.status);
    if (CACHE.orders) delete CACHE.orders;   // force fresh so the change shows immediately
    logEvent(req.session.username, 'production_stage', { id, line, stage: s, ip: clientIp(req) });
    res.json({ ok: true, line: line, stage: s });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Factory drags a team member onto a production stage of a line (or clears it: name empty)
app.post('/api/crew', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory')) return res.status(403).json({ ok: false, error: 'factory only' });
  const b = req.body || {}, id = b.id, line = Math.max(0, parseInt(b.line, 10) || 0), stage = parseInt(b.stage, 10);
  const name = String(b.name || '').replace(/[,@:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
  const op = b.op === 'remove' ? 'remove' : 'add';   // add one person to the stage, or remove one (no name = clear the stage)
  if (!id || !(stage >= 0 && stage <= 4)) return res.status(400).json({ ok: false, error: 'bad request' });
  try {
    const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,tags`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!r.ok) throw new Error('Shopify ' + r.status);
    const cur = ((await r.json()).order || {}).tags || '';
    const pre = 'crew:' + line + ':' + stage + ':';
    const tags = cur.split(',').map(t => t.trim()).filter(t => t && !(t.startsWith(pre) && (!name || t.slice(pre.length).split('@')[0] === name)));
    const day = uaeNow().slice(0, 10);
    if (name && op === 'add') tags.push(pre + name + '@' + day);
    const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, {
      method: 'PUT', headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } }) });
    if (!up.ok) throw new Error('Shopify PUT ' + up.status);
    if (CACHE.orders) delete CACHE.orders;
    logEvent(req.session.username, 'crew', { id, line, stage, name, op, ip: clientIp(req) });
    res.json({ ok: true, line, stage, name, op, date: day });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Book (or clear) the delivery date + time agreed with the customer for one line. Booking moves the line to stage 5.
app.post('/api/delivery', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory') && !hasRole(req, 'sales') && !hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'not allowed' });
  const b = req.body || {}, id = b.id, line = Math.max(0, parseInt(b.line, 10) || 0);
  const when = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(b.when || '')) ? b.when : '';
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try {
    const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,tags`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!r.ok) throw new Error('Shopify ' + r.status);
    const cur = ((await r.json()).order || {}).tags || '';
    const pdStage = t => { const m = t.match(/^pd:(\d+):(\d)@/); return m && +m[1] === line ? +m[2] : null; };
    let tags = cur.split(',').map(t => t.trim()).filter(t => t && !t.startsWith('delivery:' + line + ':'));
    const s = when ? 6 : (tags.some(t => pdStage(t) === 5) ? 5 : 4);   // booked → 6; cleared → back to the warehouse (5) if it was stored, else Packing
    tags = tags.filter(t => !new RegExp('^prodstage:' + line + ':').test(t) && !/^prodstage:\d+$/.test(t) && !(pdStage(t) != null && pdStage(t) > s));
    tags.push('prodstage:' + line + ':' + s);
    if (when) { tags.push('delivery:' + line + ':' + when); if (!tags.some(t => pdStage(t) === 6)) tags.push('pd:' + line + ':6@' + uaeNow()); }
    const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, {
      method: 'PUT', headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } }) });
    if (!up.ok) throw new Error('Shopify PUT ' + up.status);
    if (CACHE.orders) delete CACHE.orders;
    logEvent(req.session.username, 'delivery', { id, line, when, ip: clientIp(req) });
    res.json({ ok: true, line, when, stage: s });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Delivered: record it on the order, then mark THAT line item fulfilled in Shopify (the only thing we write back).
// Needs the app's fulfilment permission (write_merchant_managed_fulfillment_orders); without it the delivery is still
// recorded and the dashboard shows "Shopify not updated yet" so it can be retried once the permission is added.
async function shopifyGql(query, variables) {
  const r = await fetch(`https://${STORE}/admin/api/${APIVER}/graphql.json`, { method: 'POST',
    headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  return r.json();
}
async function fulfilLine(orderId, line) {
  const q = `query($id:ID!){ order(id:$id){ lineItems(first:50){ nodes{ id } } fulfillmentOrders(first:20){ nodes{ id status lineItems(first:50){ nodes{ id remainingQuantity lineItem{ id } } } } } } }`;
  const d = await shopifyGql(q, { id: 'gid://shopify/Order/' + orderId });
  if (d.errors) throw new Error((d.errors[0] && d.errors[0].message) || 'Shopify error');
  const o = d.data && d.data.order; if (!o) throw new Error('order not found');
  const li = (o.lineItems.nodes[line] || {}).id; if (!li) throw new Error('line not found');
  for (const fo of o.fulfillmentOrders.nodes) {
    if (!['OPEN', 'IN_PROGRESS'].includes(fo.status)) continue;
    const fli = fo.lineItems.nodes.find(x => x.lineItem.id === li && x.remainingQuantity > 0);
    if (!fli) continue;
    const m = `mutation($f:FulfillmentInput!){ fulfillmentCreate(fulfillment:$f){ fulfillment{ id status } userErrors{ field message } } }`;
    const r = await shopifyGql(m, { f: { notifyCustomer: false, lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: [{ id: fli.id, quantity: fli.remainingQuantity }] }] } });
    if (r.errors) throw new Error((r.errors[0] && r.errors[0].message) || 'Shopify error');
    const ue = r.data.fulfillmentCreate.userErrors; if (ue && ue.length) throw new Error(ue[0].message);
    return true;
  }
  return true;   // nothing left to fulfil for this line (already fulfilled)
}
app.post('/api/delivered', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory') && !hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'factory only' });
  const b = req.body || {}, id = String(b.id || '').replace(/\D/g, ''), line = Math.max(0, parseInt(b.line, 10) || 0), undo = !!b.undo;
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try {
    const r = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json?fields=id,tags`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    if (!r.ok) throw new Error('Shopify ' + r.status);
    const cur = ((await r.json()).order || {}).tags || '';
    let tags = cur.split(',').map(t => t.trim()).filter(t => t && !t.startsWith('delivered:' + line + '@'));
    const day = uaeNow().slice(0, 10);
    if (!undo) tags.push('delivered:' + line + '@' + day);
    let shop = false, shopErr = '';
    if (!undo && !tags.includes('shopfulfilled:' + line)) {
      try { await fulfilLine(id, line); shop = true; tags.push('shopfulfilled:' + line); }
      catch (e) { shopErr = /access|scope|permission|denied/i.test(e.message) ? 'needs-permission' : e.message; }
    } else if (!undo) shop = true;
    const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, { method: 'PUT',
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } }) });
    if (!up.ok) throw new Error('Shopify PUT ' + up.status);
    if (CACHE.orders) delete CACHE.orders;
    logEvent(req.session.username, undo ? 'delivered_undo' : 'delivered', { id, line, shopify: shop ? 'fulfilled' : shopErr, ip: clientIp(req) });
    res.json({ ok: true, line, date: undo ? '' : day, shopify: shop, shopErr });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Staff pass for the sales form (nader.ae/pages/sales-form is staff-only): signed with FORM_SECRET, valid 12h.
// The form asks the worker to verify it; it carries who logged in so the form can lock the Sales Agent.
app.get('/api/formlink', requireAuth, (req, res) => {
  if (!hasRole(req, 'sales') && !hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'sales only' });
  if (!FORM_SECRET) return res.status(500).json({ ok: false, error: 'not configured' });
  const payload = Buffer.from(JSON.stringify({ u: req.session.username, n: req.session.name, a: hasRole(req, 'admin'), e: Date.now() + 12 * 3600e3 })).toString('base64url');
  const sig = crypto.createHmac('sha256', FORM_SECRET).update(payload).digest('hex');
  logEvent(req.session.username, 'sales_form_open', { ip: clientIp(req) });
  res.json({ ok: true, k: payload + '.' + sig });
});

// Mark a cash / bank-transfer draft as PAID → completes the draft into a real (paid) order,
// which moves it out of Drafts and into Orders. (Card orders convert via the checkout link.)
app.post('/api/mark_paid', requireAuth, async (req, res) => {
  if (!hasRole(req, 'sales') && !hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'not allowed' });
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try {
    // No payment_pending param → Shopify marks the resulting order as PAID.
    const r = await fetch(`https://${STORE}/admin/api/${APIVER}/draft_orders/${id}/complete.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' }
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ ok: false, error: 'Shopify ' + r.status, detail: data });
    const dd = data.draft_order || {};
    if (CACHE.drafts) delete CACHE.drafts;   // draft is now completed → hide from Drafts
    if (CACHE.orders) delete CACHE.orders;    // new order appears in Orders
    logEvent(req.session.username, 'mark_paid', { id, order_id: dd.order_id, ip: clientIp(req) });
    res.json({ ok: true, order_id: dd.order_id, status: dd.status });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- factory spec sheets (saved per order line in Cloudflare KV via the worker) ---------- */
const specKey = id => String(id || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 80);
async function workerJson(pathname, opts) {
  const r = await fetch(WORKER_URL + pathname, Object.assign({}, opts, {
    headers: Object.assign({ 'X-Form-Secret': FORM_SECRET, 'Content-Type': 'application/json' }, (opts && opts.headers) || {})
  }));
  return r.json().catch(() => ({ ok: false, error: 'bad worker response' }));
}
app.get('/api/specs', requireAuth, async (req, res) => {
  try { res.json(await workerJson('/spec')); } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
app.get('/api/spec', requireAuth, async (req, res) => {
  const id = specKey(req.query.id); if (!id) return res.status(400).json({ ok: false, error: 'no id' });
  try { res.json(await workerJson('/spec/' + id)); } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
app.post('/api/spec', requireAuth, async (req, res) => {
  const b = req.body || {}, id = specKey(b.id), data = b.data;
  if (!id || !data || typeof data !== 'object') return res.status(400).json({ ok: false, error: 'id and data required' });
  const c = data.cust || {};
  let status = b.status;
  try {
    /* a LOCKED drawing (drawing complete) can only be changed/unlocked by an admin — everyone else can still edit
       notes & customer details, but the drawing parts are kept exactly as they were locked */
    if (!hasRole(req, 'admin')) {
      const cur = await workerJson('/spec/' + id).catch(() => null);
      const old = cur && cur.data;
      if (old && old.locked) {
        ['model', 'V', 'drawings', 'drawStatus', 'photo', 'photoSide', 'mirror', 'photoManual', 'photoCleared', 'manualChosen', 'locked', 'completedBy']
          .forEach(k => { if (k in old) data[k] = old[k]; else delete data[k]; });
        status = (cur.meta && cur.meta.status) || 'complete';
      }
    }
    const out = await workerJson('/spec/' + id, { method: 'POST', body: JSON.stringify({ data,
      meta: { product: data.product || '', customer: c.name || '', orderNo: data.orderNo || '', by: req.session.username,
        status: ['complete', 'manual', 'check'].includes(status) ? status : '' } }) });
    // log at most one "spec_edit" per user+sheet per 10 min so autosave doesn't flood the audit log
    const k = req.session.username + '|' + id, now = Date.now();
    if (!specLogged[k] || now - specLogged[k] > 600000) { specLogged[k] = now; logEvent(req.session.username, 'spec_edit', { id, product: data.product || '' }); }
    res.json(out);
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
const specLogged = {};
// The sales form's saved state (field values per item) — proxied because the worker only allows nader.ae origins.
app.get('/api/formstate', requireAuth, async (req, res) => {
  const id = String(req.query.id || '').replace(/[^a-z0-9_]/gi, ''); if (!id) return res.status(400).json({ ok: false });
  try { const r = await fetch(WORKER_URL + '/state/' + id); res.status(r.status).type('json').send(await r.text()); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

/* ---------- fabric ordered / delivered per order line: dates + attachments (POs, invoices, photos) in Cloudflare KV ---------- */
let FABRIC = null, FABRIC_AT = 0;
async function fabricIndex(fresh) {
  if (!fresh && FABRIC && Date.now() - FABRIC_AT < 20000) return FABRIC;
  const d = await workerJson('/fabric'); if (d && d.ok) { FABRIC = d.index || {}; FABRIC_AT = Date.now(); }
  return FABRIC || {};
}
let fabricQ = Promise.resolve();   // one write at a time (read-modify-write of the shared index)
function fabricUpdate(key, fn) {
  const run = fabricQ.then(async () => {
    const idx = await fabricIndex(true);
    const rec = fn(JSON.parse(JSON.stringify(idx[key] || { ordered: '', delivered: '', files: { ordered: [], delivered: [] } })));
    const out = await workerJson('/fabric', { method: 'POST', body: JSON.stringify({ key, rec }) });
    if (!out || !out.ok) throw new Error('save failed');
    FABRIC[key] = out.rec; return out.rec;
  });
  fabricQ = run.catch(() => {}); return run;
}
const fabKey = (id, line) => String(parseInt(id, 10) || 0) + ':' + Math.max(0, parseInt(line, 10) || 0);
const fabKind = k => (k === 'delivered' ? 'delivered' : 'ordered');
app.post('/api/fabric', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory')) return res.status(403).json({ ok: false, error: 'factory only' });
  const b = req.body || {}, kind = fabKind(b.kind), date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
  try {
    const rec = await fabricUpdate(fabKey(b.id, b.line), r => { r[kind] = date; return r; });
    logEvent(req.session.username, 'fabric_' + kind, { id: b.id, line: b.line, date, ip: clientIp(req) });
    res.json({ ok: true, rec });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
app.post('/api/fabric/upload', requireAuth, express.raw({ type: () => true, limit: '20mb' }), async (req, res) => {
  if (!hasRole(req, 'factory')) return res.status(403).json({ ok: false, error: 'factory only' });
  const q = req.query, kind = fabKind(q.kind), name = String(q.name || 'file').replace(/[\r\n"]/g, '').slice(0, 120);
  const buf = req.body; if (!buf || !buf.length) return res.status(400).json({ ok: false, error: 'empty file' });
  const fid = crypto.randomBytes(12).toString('hex');
  try {
    const up = await fetch(WORKER_URL + '/file/' + fid, { method: 'PUT', body: buf,
      headers: { 'X-Form-Secret': FORM_SECRET, 'Content-Type': req.headers['content-type'] || 'application/octet-stream', 'X-File-Name': name } });
    if (!up.ok) throw new Error('upload failed ' + up.status);
    const file = { id: fid, name, type: String(req.headers['content-type'] || ''), size: buf.length, by: req.session.name || req.session.username, at: uaeNow() };
    const rec = await fabricUpdate(fabKey(q.id, q.line), r => { r.files = r.files || {}; (r.files[kind] = r.files[kind] || []).push(file); return r; });
    logEvent(req.session.username, 'fabric_upload', { id: q.id, line: q.line, kind, name, ip: clientIp(req) });
    res.json({ ok: true, rec });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
app.post('/api/fabric/remove', requireAuth, async (req, res) => {
  if (!hasRole(req, 'factory')) return res.status(403).json({ ok: false, error: 'factory only' });
  const b = req.body || {}, kind = fabKind(b.kind), fid = String(b.fid || '').replace(/[^a-f0-9]/g, '');
  try {
    const rec = await fabricUpdate(fabKey(b.id, b.line), r => { r.files = r.files || {}; r.files[kind] = (r.files[kind] || []).filter(f => f.id !== fid); return r; });
    fetch(WORKER_URL + '/file/' + fid, { method: 'DELETE', headers: { 'X-Form-Secret': FORM_SECRET } }).catch(() => {});
    logEvent(req.session.username, 'fabric_remove', { id: b.id, line: b.line, kind, ip: clientIp(req) });
    res.json({ ok: true, rec });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
// download an attachment (any logged-in user — sales can see them too)
app.get('/api/file/:fid', requireAuth, async (req, res) => {
  const fid = String(req.params.fid || '').replace(/[^a-f0-9]/g, '');
  try {
    const r = await fetch(WORKER_URL + '/file/' + fid, { headers: { 'X-Form-Secret': FORM_SECRET } });
    if (!r.ok) return res.status(404).send('Not found');
    const name = decodeURIComponent(r.headers.get('x-file-name') || 'file');
    res.set('Content-Type', r.headers.get('content-type') || 'application/octet-stream');
    res.set('Content-Disposition', 'attachment; filename="' + name.replace(/[^\w .()-]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name));
    res.send(Buffer.from(await r.arrayBuffer()));
    logEvent(req.session.username, 'file_download', { fid, name, ip: clientIp(req) });
  } catch (e) { res.status(502).send('Download failed'); }
});

/* ---------- TEAM NOTES per order (customer calls etc.) — shared, editable by everyone, kept in Cloudflare KV ---------- */
let NOTES = null, NOTES_AT = 0;
async function notesDoc(fresh) {
  if (!fresh && NOTES && Date.now() - NOTES_AT < 15000) return NOTES;
  const d = await workerJson('/doc/notes'); if (d && d.ok) { NOTES = d.data || {}; NOTES_AT = Date.now(); }
  return NOTES || {};
}
let notesQ = Promise.resolve();
app.post('/api/notes', requireAuth, async (req, res) => {
  const b = req.body || {}, id = String(b.id || '').replace(/\D/g, ''), text = String(b.text || '').trim().slice(0, 2000);
  if (!id) return res.status(400).json({ ok: false, error: 'no order' });
  const run = notesQ.then(async () => {
    const all = JSON.parse(JSON.stringify(await notesDoc(true)));
    const list = all[id] = all[id] || [];
    const who = req.session.name || req.session.username, now = uaeNow();
    if (b.nid) {
      const n = list.find(x => x.id === b.nid); if (!n) throw new Error('note not found');
      if (b.del) all[id] = list.filter(x => x.id !== b.nid);
      else { n.text = text; n.e = now; n.eb = who; }
    } else {
      if (!text) throw new Error('empty note');
      list.push({ id: crypto.randomBytes(6).toString('hex'), t: now, by: who, text });
    }
    if (!all[id].length) delete all[id];
    const out = await docSet('notes', all); if (!out || !out.ok) throw new Error('save failed');
    NOTES = all; NOTES_AT = Date.now();
    logEvent(req.session.username, b.del ? 'note_delete' : b.nid ? 'note_edit' : 'note_add', { id, ip: clientIp(req) });
    return all[id] || [];
  });
  notesQ = run.catch(() => {});
  try { res.json({ ok: true, notes: await run }); } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

/* ---------- ADMIN: sales per agent / month / product (owners only) ---------- */
async function docGet(name) { const d = await workerJson('/doc/' + name); return (d && d.ok && d.data) || null; }
async function docSet(name, data) { return workerJson('/doc/' + name, { method: 'POST', body: JSON.stringify({ data }) }); }
// Sales agent of an order: the sales form writes "Agent: Name" in the note; older orders only know which Shopify staff
// account created them (named once by the owners). Names are tidied (capitals) so the same person adds up across both.
const tidyName = n => String(n || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b([a-z])/g, c => c.toUpperCase());
function agentOf(o, map) {
  const m = String(o.note || '').match(/Agent:\s*([^\n·]+?)\s*(?:·|\n|$)/);
  if (m && m[1].trim() && !/^other$/i.test(m[1].trim())) return tidyName(m[1]);
  if (o.user_id && map[o.user_id]) return tidyName(map[o.user_id]);
  if (o.user_id) return 'Staff account …' + String(o.user_id).slice(-4);
  if (o.source_name === 'web') return 'Online order';
  if (m) return 'Other (sales form)';
  return 'Other';
}
app.get('/api/admin/sales', requireAuth, async (req, res) => {
  if (!hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'admin only' });
  try {
    const [raw, map] = await Promise.all([cached('adminSales', FETCH.adminSales, req.query.fresh === '1'), docGet('agents').catch(() => null)]);
    const agents = map || {}, accounts = {};
    const rows = raw.map(o => {
      const fin = String(o.financial_status || '').toLowerCase();
      const st = (o.cancelled_at || fin === 'refunded' || fin === 'voided') ? 'x' : (o.fulfillment_status === 'fulfilled' ? 's' : 'o');
      if (o.user_id) { const a = accounts[o.user_id] = accounts[o.user_id] || { n: 0, name: agents[o.user_id] || '' }; a.n++; }
      const refunded = Math.max(0, Math.round(((+o.total_price || 0) - (o.current_total_price != null ? +o.current_total_price : +o.total_price || 0)) * 100) / 100);
      return { id: o.id, n: o.name, d: String(o.created_at || '').slice(0, 10), t: +o.total_price || 0, st, fin, rf: refunded, cx: o.cancelled_at ? String(o.cancelled_at).slice(0, 10) : '', why: o.cancel_reason || '',
        a: agentOf(o, agents), u: o.user_id || null, city: (o.shipping_address && (o.shipping_address.city || o.shipping_address.province)) || '',
        it: (o.line_items || []).map(li => [li.title, li.quantity || 1, +li.price || 0]), p: promiseOf(o), open: st === 'o' };
    });
    res.json({ ok: true, rows, accounts, at: Date.now() });
  } catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});
app.post('/api/admin/agents', requireAuth, async (req, res) => {
  if (!hasRole(req, 'admin')) return res.status(403).json({ ok: false, error: 'admin only' });
  const uid = String((req.body || {}).uid || '').replace(/\D/g, ''), name = String((req.body || {}).name || '').replace(/[<>]/g, '').trim().slice(0, 40);
  if (!uid) return res.status(400).json({ ok: false, error: 'no account' });
  try { const map = (await docGet('agents')) || {}; if (name) map[uid] = name; else delete map[uid]; await docSet('agents', map);
    logEvent(req.session.username, 'agent_name', { uid, name, ip: clientIp(req) }); res.json({ ok: true, map }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

// admin: which Shopify permissions the dashboard's token has (to confirm fulfilment / order editing are enabled)
app.get('/api/admin/shopify-scopes', requireAuth, async (req, res) => {
  if (!hasRole(req, 'admin')) return res.status(403).json({ ok: false });
  try { const r = await fetch(`https://${STORE}/admin/oauth/access_scopes.json`, { headers: { 'X-Shopify-Access-Token': TOKEN } });
    const d = await r.json(); res.json({ ok: true, scopes: (d.access_scopes || []).map(x => x.handle).sort() }); }
  catch (e) { res.status(502).json({ ok: false, error: e.message }); }
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, store: STORE, apiVersion: APIVER, configured: !!(STORE && TOKEN) }));

/* ---------- static ---------- */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Nader dashboard on :${PORT} (store ${STORE || 'unset'})`));
