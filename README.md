# Profit Sheet

A daily profit dashboard for the Shopify stores. It replaces the manual spreadsheet: orders, refunds and transaction fees sync from Shopify, ad spend is entered per day, supplier invoices give each order's actual cost of goods (with per-SKU costs as the estimate until an invoice arrives), and Claude reads the invoices and answers questions about the data.

## What it calculates

Same columns as the spreadsheet, per day and per month:

| Column | How |
|---|---|
| Gross revenue | Order totals minus VAT (incl. shipping, after discounts), by order date |
| Refunds | Refunds minus VAT, **on the day they were issued**, synced automatically |
| Revenue | Gross revenue − refunds |
| Cost of goods | What the supplier invoiced for the order (goods + shipping + fees); until an invoice is approved, units × the SKU's cost on the order date |
| Ad spend | Entered per day per store, in the ad account's currency |
| Media buyer fee | Ad spend × the store's media buyer % |
| Transaction fees | The fee Shopify reports (Shopify Payments), else the store's fee rule |
| Profit | Revenue − COGS − ad spend − media buyer fee − transaction fees |
| ROAS / Gross ROAS / POAS | Revenue, gross revenue and profit ÷ ad spend |
| Profit % / COG % | ÷ gross revenue |

The old spreadsheet's Profit formula started from gross revenue, so refunds were never subtracted. Here they are.

**Currency.** Every amount is converted to USD with the ECB rate for that day. A day's rates are stored the first time they're used and never refetched, so past figures don't move with the market. Each store's sheet is shown in its **report currency** (set it to the Google Ads account's currency) using the same locked rates. The all-stores view is in USD.

## Pages

- **Profit sheet**: the monthly sheet per store or for all stores, with KPIs, a daily profit chart, profit/loss per store and for the whole business (this month, year to date or all time), and warnings (orders not invoiced, missing costs, days without ad spend, failed syncs).
- **Daily check**: per store and day, whether ad spend is entered and how many of that day's orders are covered by an invoice; invoices waiting for review and sync status.
- **Ask**: questions in plain English ("refunds in the last 14 days", "most returned products"). Claude runs read-only SQL on the synced data and shows the queries it used.
- **Orders**: per-order profit.
- **Refunds**: every refund, refunds that hit an earlier month's orders, and the most refunded products with refund rate.
- **Ad spend**: add a day or paste many days at once.
- **Products & costs**: cost per SKU with history; a new cost applies from its start date.
- **Supplier invoices**: choose the store, upload the invoice (PDF, Excel/CSV or screenshot). Claude reads it and each line is matched to the store's order by number (prefixes like `DK1234` vs `#1234` are fine). It flags unknown order numbers (and whether another store has that number), orders already on another invoice, unit counts that differ from the order, costs far from the estimate, cancelled orders, a store name on the invoice that doesn't match, and totals that don't add up. Approved lines replace the estimate as the order's cost of goods; deleting the invoice puts the estimate back.
- **Supplier quotes**: price lists per SKU (sheet, PDF, screenshot or pasted text); Claude matches lines to SKUs and flags price jumps, unknown SKUs and assumed currencies. Nothing changes until you approve.
- **Stores**: Shopify credentials, report currency, fee rules, media buyer %.

## Run locally

```bash
pnpm install
cp .env.example .env.local   # add ANTHROPIC_API_KEY to try Ask and quotes
pnpm seed:demo               # optional: a demo store with sample orders
pnpm dev
```

Without `DATABASE_URL` it uses an embedded Postgres in `.data/`, and without `DASHBOARD_PASSWORD` there is no login (local only).

## Connect a Shopify store

Shopify no longer lets you create new private apps from the store admin. Use the Dev Dashboard:

1. In https://dev.shopify.com create an app, create a version with the scopes `read_orders` and `read_all_orders` (for history older than 60 days), and release it.
2. Install it on each store.
3. In the dashboard, Stores → Add store: choose *Dev Dashboard app*, paste the **Client ID** and **Client secret**.

This works when the app and the stores are in the same Shopify organization. Stores that already have an old admin-created custom app can paste its Admin API access token instead.

The first sync imports the last 90 days. After that it syncs every hour and picks up new refunds on old orders.

## Deploy to Vercel

1. `npx vercel@latest login`, then `npx vercel@latest link` in this folder.
2. Add a Postgres database from the Marketplace (Neon): `npx vercel@latest integration add neon`. It sets `DATABASE_URL`.
3. Add the other variables from `.env.example` (`vercel env add NAME`).
4. `npx vercel@latest --prod`. Migrations run automatically during the build.

The hourly sync cron in `vercel.json` needs the **Pro** plan. On Hobby, crons can only run once a day; use the *Sync now* button in between. Uploads are limited to 4 MB (Vercel's request limit is 4.5 MB).

## Notes

- Cost of goods is not reduced when a refunded item is restocked; restocked quantities are recorded (`refunds.restocked_qty`, `refund_lines.restock_type`) if you want that later.
- Refund VAT is removed in proportion to the order's VAT share.
- Claude model: `claude-opus-5-5` (see `src/lib/config.ts`).
