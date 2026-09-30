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
  admin: { name: "Admin", roles: ["sales", "factory", "admin"], salt: "52009a8101b9e4013040a20e6e08f105", hash: "4b55e70893e982a4e49d0a980dc80cd079fe1967c65d29e2565527fcbe8269fa" },
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
// Production timeline stored on the order as a tag `prodstage:N` (0=Drawing … 4=Packing, 5=Delivery booked). Shared + persistent.
const PROD_STAGE_COUNT = 6;
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
      promise: promiseOf(o),
      prod_stage: Math.min.apply(null, prodStagesFromTags(o.tags, (o.line_items || []).length)),  // order-level = least-advanced line
      state: orderState(o),   // open | shipped | refunded  (safe to expose to factory — not price)
      items: mapLineItems(o.line_items)
    }));
    const out = factoryOnly(req) ? orders.map(stripPrice) : orders;
    let stats = raw; try { stats = await cached('stats', FETCH.stats, false); } catch (e) {}
    let fab = {}; try { fab = await fabricIndex(false); } catch (e) {}
    out.forEach(o => { const f = {}; (o.items || []).forEach((it, i) => { const r = fab[o.id + ':' + i]; if (r) f[i] = r; }); o.fabric = f; });
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
    const s = when ? 5 : 4;
    tags = tags.filter(t => !new RegExp('^prodstage:' + line + ':').test(t) && !/^prodstage:\d+$/.test(t) && !(pdStage(t) != null && pdStage(t) > s));
    tags.push('prodstage:' + line + ':' + s);
    if (when) { tags.push('delivery:' + line + ':' + when); if (!tags.some(t => pdStage(t) === 5)) tags.push('pd:' + line + ':5@' + uaeNow()); }
    const up = await fetch(`https://${STORE}/admin/api/${APIVER}/orders/${id}.json`, {
      method: 'PUT', headers: { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: { id: Number(id), tags: tags.join(', ') } }) });
    if (!up.ok) throw new Error('Shopify PUT ' + up.status);
    if (CACHE.orders) delete CACHE.orders;
    logEvent(req.session.username, 'delivery', { id, line, when, ip: clientIp(req) });
    res.json({ ok: true, line, when, stage: s });
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

app.get('/api/health', (req, res) =>
  res.json({ ok: true, store: STORE, apiVersion: APIVER, configured: !!(STORE && TOKEN) }));

/* ---------- static ---------- */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Nader dashboard on :${PORT} (store ${STORE || 'unset'})`));
