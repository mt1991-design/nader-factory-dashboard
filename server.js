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
const PW = { sales: process.env.SALES_PASSWORD || '', factory: process.env.FACTORY_PASSWORD || '' };

app.use(express.json());
app.use(cookies);

/* ---------- tiny signed-cookie session (no external deps) ---------- */
function sign(role, exp) {
  const body = `${role}|${exp}`;
  const mac  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${Buffer.from(body).toString('base64url')}.${mac}`;
}
function verify(tok) {
  if (!tok || tok.indexOf('.') < 0) return null;
  const [b64, mac] = tok.split('.');
  let body;
  try { body = Buffer.from(b64, 'base64url').toString(); } catch (e) { return null; }
  const expect = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== expect.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  const [role, exp] = body.split('|');
  if (!exp || Date.now() > Number(exp)) return null;
  return { role };
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
  if (!sess) return res.status(401).json({ ok: false, error: 'auth' });
  req.session = sess;
  next();
}

app.post('/api/login', (req, res) => {
  const { role, password } = req.body || {};
  if (!PW[role] || password !== PW[role]) return res.json({ ok: false });
  const exp = Date.now() + 12 * 3600 * 1000; // 12h
  const tok = sign(role, exp);
  res.setHeader('Set-Cookie',
    `nfs_session=${tok}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`);
  res.json({ ok: true, role });
});

// Restore an existing session on page load/refresh, and slide it forward 12h on use.
app.get('/api/session', (req, res) => {
  const sess = verify(req.cookies.nfs_session);
  if (!sess) return res.json({ ok: false });
  const exp = Date.now() + 12 * 3600 * 1000;
  res.setHeader('Set-Cookie',
    `nfs_session=${sign(sess.role, exp)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${12 * 3600}`);
  res.json({ ok: true, role: sess.role });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'nfs_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
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
    const out = req.session.role === 'factory' ? orders.map(stripPrice) : orders;
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
      invoice_url: d.invoice_url || '',
      shipping_address: mapAddress(d.shipping_address),
      billing_address: mapAddress(d.billing_address),
      admin_url: `https://${STORE}/admin/draft_orders/${d.id}`,
      items: mapLineItems(d.line_items)
    }));
    const out = req.session.role === 'factory' ? drafts.map(stripPrice) : drafts;
    res.json({ ok: true, drafts: out });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

// Factory advances the production timeline; stored as a `prodstage:N` tag on the order (persistent + visible in Shopify).
app.post('/api/production', requireAuth, async (req, res) => {
  if (req.session.role !== 'factory') return res.status(403).json({ ok: false, error: 'factory only' });
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
    res.json({ ok: true, line: line, stage: s });
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
