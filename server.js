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

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'nfs_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

/* ---------- Shopify Admin proxy ---------- */
async function shopify(pathAndQuery, maxPages = 6) {
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

function custName(c) {
  if (!c) return '';
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || '';
}
function mapLineItems(arr) {
  return (arr || []).map(li => ({ product: li.title, sku: li.sku || '', qty: li.quantity || 1 }));
}

app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const raw = await shopify('orders.json?status=any&limit=250&fields=id,name,created_at,customer,line_items,financial_status,fulfillment_status,tags');
    const orders = raw.map(o => ({
      order: o.name,
      kind: 'order',
      customer: custName(o.customer),
      date: (o.created_at || '').slice(0, 10),
      financial_status: o.financial_status || '',
      fulfillment_status: o.fulfillment_status || 'unfulfilled',
      tags: o.tags || '',
      items: mapLineItems(o.line_items)
    }));
    res.json({ ok: true, orders });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

app.get('/api/draft_orders', requireAuth, async (req, res) => {
  try {
    const raw = await shopify('draft_orders.json?limit=250');
    const drafts = raw.map(d => ({
      order: d.name,
      kind: 'draft',
      customer: custName(d.customer),
      date: (d.created_at || '').slice(0, 10),
      status: d.status || 'open',        // open | invoice_sent | completed
      tags: d.tags || '',
      invoice_url: d.invoice_url || '',
      items: mapLineItems(d.line_items)
    }));
    res.json({ ok: true, drafts });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message, detail: e.body });
  }
});

app.get('/api/health', (req, res) =>
  res.json({ ok: true, store: STORE, apiVersion: APIVER, configured: !!(STORE && TOKEN) }));

/* ---------- static ---------- */
app.use(express.static(path.join(__dirname), { index: 'index.html', extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.listen(PORT, () => console.log(`Nader dashboard on :${PORT} (store ${STORE || 'unset'})`));
