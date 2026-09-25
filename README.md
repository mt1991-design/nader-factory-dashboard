# Nader Factory & Sales Dashboard

Internal app for the Nader sales + factory teams. Serves the single-page dashboard
(`index.html`) and proxies **read-only** Shopify Admin data so the store token is never
exposed to the browser.

## Routes
- `/` — the dashboard (login → Sales or Factory)
- `POST /api/login` `{role, password}` → sets a signed 12h session cookie
- `POST /api/logout`
- `GET /api/orders` — real/placed orders (needs `read_orders` scope)
- `GET /api/draft_orders` — draft orders (needs `read_draft_orders` scope)
- `GET /api/health`

The Sales dashboard "＋ New order" button opens the bespoke Sales Form at
`https://nader.ae/pages/sales-form`.

## Environment variables (set in DigitalOcean → App → Settings → Env)
| key | example | notes |
|-----|---------|-------|
| `SHOPIFY_STORE` | `91fb05.myshopify.com` | |
| `SHOPIFY_TOKEN` | `shpat_…` | Admin token, needs `read_orders` + `read_draft_orders` |
| `SHOPIFY_API_VERSION` | `2025-01` | |
| `SESSION_SECRET` | long random string | signs the login cookie |
| `SALES_PASSWORD` | | Sales role password |
| `FACTORY_PASSWORD` | | Factory role password |

## Run locally
```
npm install
SHOPIFY_STORE=… SHOPIFY_TOKEN=… SESSION_SECRET=dev SALES_PASSWORD=… FACTORY_PASSWORD=… npm start
# http://localhost:8080
```

## Deploy
DigitalOcean App Platform (Node buildpack): `npm install` → `npm start`, listens on `$PORT`.
