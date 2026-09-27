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
  admin:    { name: "Admin",          roles: ["sales", "factory", "admin"], salt: "8ec5da97f7e275da088ac2c4ba6f3ca8", hash: "d4c7e5dacc420351ee742f59b4d40e1d1b4bab582975451f0ba9ea623d3fb5d9" },
  mohammed: { name: "Mohammed",       roles: ["sales"],                     salt: "44fa5269a6718a7a306532a61ba910f5", hash: "996d2736bacc4b3810c222325cf83db6316833adaaab0cf59631cd50989bf240" },
  abdul:    { name: "Abdul",          roles: ["sales", "factory"],          salt: "bddd62168c55e7a2c4588224f29d020b", hash: "feede78530d367c9ac4b9f7ba7460248356e9d0b71b9eb15e0fd15a12143950e" },
  zahak:    { name: "Zahak",          roles: ["sales"],                     salt: "aa2dff4f4aed7d0a2f7e12df8f96cb6f", hash: "c6568b8860c8cbc989ada742e8cbcd706cd68323361b2b9043553680412cdadf" },
  adnan:    { name: "Adnan",          roles: ["sales"],                     salt: "bb5fc4c98a8ccb90bccc0d4643d169d2", hash: "e433348737656403001f8437671413ac9989aa456c8b9427d6fa447497c31998" },
  nizam:    { name: "Nizam",          roles: ["sales"],                     salt: "d47a879917e5526ed0f6a4a1a3c1e2e7", hash: "973652ea5bfffbf63b5cd895be2643b2455646c392a206540e00f5d740d497db" },
  aslam:    { name: "Mohammed Aslam", roles: ["sales", "factory"],          salt: "08b9113d0d29bb7e5f1c257a09ad77a8", hash: "b1e444a6c4fe9ac5a13b4c92460bc5b78e21dd4795b75015f93b296da23628e4" },
  sam:      { name: "Sam",            roles: ["sales", "factory"],          salt: "baee45f03e78cd9ca17b82b2f56b90db", hash: "057b1a36ce267a4ab31515f8302cb672107e30e88301cdf72a85952f3801e6e4" },
};
function checkPassword(user, password) {
  if (!user || !password) return false;
  try {
    const h = crypto.scryptSync(String(password), Buffer.from(user.salt, 'hex'), 32);
    return crypto.timingSafeEqual(h, Buffer.from(user.hash, 'hex'));
  } catch (e) { return false; }
}

app.use(express.json());
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

function setSessionCookie(res, username) {
  const exp = Date.now() + 12 * 3600 * 1000; // 12h
  res.setHeader('Set-Cookie',
    `nfs_session=${sign({ u: username, e: exp })}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`);
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
app.get('/api/session', (req, res) => {
  const sess = verify(req.cookies.nfs_session);
  const user = sess && USERS[sess.u];
  if (!user) return res.json({ ok: false });
  setSessionCookie(res, sess.u);
  res.json({ ok: true, username: sess.u, name: user.name, roles: user.roles });
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

// 60s in-memory cache so repeated dashboard loads don't re-scan the whole store.
// Pass ?fresh=1 (the Refresh button) to bypass it.
const CACHE = {};
const TTL = 60 * 1000;
async function cached(name, fetcher, fresh) {
  const hit = CACHE[name];
  if (!fresh && hit && (Date.now() - hit.at) < TTL) return hit.data;
  const data = await fetcher();
  CACHE[name] = { at: Date.now(), data };
  return data;
}

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
// Production timeline stored on the order as a tag `prodstage:N` (0=Drawing … 4=Packing). Shared + persistent.
const PROD_STAGE_COUNT = 5;
const clampStage = n => Math.max(0, Math.min(PROD_STAGE_COUNT - 1, parseInt(n, 10) || 0));
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
    const raw = await cached('orders', () => shopify(
      'orders.json?status=any&limit=250&fields=id,name,created_at,processed_at,financial_status,fulfillment_status,currency,total_price,subtotal_price,total_tax,customer,email,phone,shipping_address,billing_address,line_items,tags,note,fulfillments,cancelled_at,updated_at'
    ), fresh);
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
      shipping_address: mapAddress(o.shipping_address),
      billing_address: mapAddress(o.billing_address),
      admin_url: `https://${STORE}/admin/orders/${o.id}`,
      prod_stages: prodStagesFromTags(o.tags, (o.line_items || []).length),
      prod_stage: Math.min.apply(null, prodStagesFromTags(o.tags, (o.line_items || []).length)),  // order-level = least-advanced line
      state: orderState(o),   // open | shipped | refunded  (safe to expose to factory — not price)
      items: mapLineItems(o.line_items)
    }));
    const out = factoryOnly(req) ? orders.map(stripPrice) : orders;
    res.json({ ok: true, orders: out });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

app.get('/api/draft_orders', requireAuth, async (req, res) => {
  try {
    const fresh = req.query.fresh === '1';
    const raw = await cached('drafts', () => shopify('draft_orders.json?limit=250'), fresh);
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
    // keep other tags; drop this line's old stage + any legacy whole-order stage
    const tags = cur.split(',').map(t => t.trim()).filter(t =>
      t && !new RegExp('^prodstage:' + line + ':').test(t) && !/^prodstage:\d+$/.test(t));
    tags.push('prodstage:' + line + ':' + s);
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

app.get('/api/health', (req, res) =>
  res.json({ ok: true, store: STORE, apiVersion: APIVER, configured: !!(STORE && TOKEN) }));

/* ---------- static ---------- */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Nader dashboard on :${PORT} (store ${STORE || 'unset'})`));
