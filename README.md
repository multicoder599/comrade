# Comrade Shop POS

Point-of-sale system for **Comrade Shop** — two shops (A and B) running on one
server, with a separate admin panel, MegaPay (M-Pesa) payment prompts for
Shop A, and an installable app (PWA).

## What runs where

| URL | What it is |
|---|---|
| `http://169.58.58.133:5105` | Cashier till — log in as **Shop A** or **Shop B** |
| `http://169.58.58.133:5106` | **Admin panel** (opens `/admin`) — products, prices, stock, sales, reports, users |

Both ports are served by **one Node process**. The admin panel lives at the
`/admin` route, so it works on either port; 5106 is just the door you give it.

## Features

- **Buying / selling prices** per product, with live **margin** shown in admin
- **Retail & wholesale prices** — the cashier flips a switch per sale
- **Bargaining** — per-product "allow bargain" toggle; the cashier can type any
  price at the till (list price shown struck through)
- **4 sale tabs** — the cashier runs up to four customers at once; tabs survive
  a browser refresh
- **MegaPay M-Pesa STK push** (Shop A) — customer gets a phone prompt, the till
  confirms automatically; stock is restored if payment fails
- **Stock per shop** — sales decrement it, admin restocks, low-stock alerts
- **Reports** — revenue / cost / profit per shop, per day, per payment method,
  top products, CSV export
- **Receipts** — printable receipt after every sale
- **Installable** — "Add to Home Screen" on the till tablet/phone (PWA)

## Default logins (change them!)

| Account | Username | Password | Role |
|---|---|---|---|
| Owner | `admin` | `admin123` | admin |
| Shop A till | `shopa` | `shopa123` | cashier (A) |
| Shop B till | `shopb` | `shopb123` | cashier (B) |

Change passwords from **Admin → Settings** (your own) and **Admin → Users**
(others). Demo products are seeded on first boot — edit or delete them in
**Admin → Products**.

## Deploy on your VPS (GitHub → pull)

Requires Node.js 20+ on the VPS.

```bash
# 1. push this folder to GitHub (from your machine)
git init && git add . && git commit -m "Comrade Shop POS"
git remote add origin git@github.com:YOURUSER/comrade-shop-pos.git
git push -u origin main

# 2. on the VPS
git clone git@github.com:YOURUSER/comrade-shop-pos.git
cd comrade-shop-pos
cp .env.example .env          # then edit .env — see below
npm install
npm run build
npm start                     # serves 5105 + 5106 + 3000
```

Keep it running with pm2:

```bash
npm install -g pm2
pm2 start "node dist/boot.js" --name comrade-pos
pm2 save && pm2 startup
```

To update later: `git pull && npm install && npm run build && pm2 restart comrade-pos`.

### `.env` on the VPS

```ini
JWT_SECRET=<long random string>       # required — keeps logins secure
MEGAPAY_API_KEY=<from megapay.co.ke>  # Shop A M-Pesa prompts
MEGAPAY_EMAIL=<your MegaPay login email>
SHOP_PORT=5105
ADMIN_PORT=5106
DATABASE_PATH=./data/comrade-shop.db
```

### MegaPay webhook

In your MegaPay dashboard (Account Settings → Webhook), set:

```
http://169.58.58.133:5105/api/megapay/callback
```

The till also polls automatically, so sales complete even without the webhook —
the webhook just makes confirmation instant.

### Docker (alternative)

```bash
docker build -t comrade-pos .
docker run -d --name comrade-pos -p 5105:5105 -p 5106:5106 \
  -v comrade-data:/app/data --env-file .env comrade-pos
```

## Data & backups

Everything lives in one SQLite file: `./data/comrade-shop.db`.
Back it up with `cp data/comrade-shop.db backup-$(date +%F).db`.

## Tech

React + TypeScript + Vite + Tailwind (frontend) · Hono + tRPC (API) ·
Drizzle ORM + SQLite (database) · MegaPay REST API (payments).
