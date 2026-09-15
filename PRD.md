# PRD — Israeli Savings Products Comparison Site

## 1. Summary

A static, Hebrew-first web app for comparing Israeli long-term savings products: **קופות גמל, קרנות השתלמות, פוליסות חיסכון, קרנות פנסיה**. Users pick a product category, filter by investment track and management company, and compare funds side by side on returns and fees.

Data comes from data.gov.il (רשות שוק ההון), refreshed monthly by GitHub Actions and committed to the repo. The deployed site has **zero runtime dependency on any external API**.

**Audience:** Israeli savers comparing their own funds, not financial professionals. Assume no finance vocabulary beyond דמי ניהול and תשואה.

---

## 2. Scope

### In scope
- Four product categories, each a separate dataset with its own schema.
- Monthly data refresh via scheduled GitHub Action.
- Browse, search, filter, sort within a category.
- Compare 2–4 funds side by side.
- Fund detail view with historical return chart.

### Out of scope (v1)
- User accounts, saved comparisons, alerts.
- Cross-category comparison (comparing a קרן פנסיה against a פוליסת חיסכון — different products, misleading).
- Any recommendation, ranking-by-quality, or scoring logic.
- English UI.

---

## 3. Data

### Known source
```
https://data.gov.il/api/3/action/datastore_search?resource_id=a30dcbea-a1d2-482c-ae29-8f781f5025fb
```

### Agent task: discover the rest before building
The other three categories have their own resource IDs. Find them via CKAN:
```
https://data.gov.il/api/3/action/package_search?q=גמל
https://data.gov.il/api/3/action/package_search?q=פנסיה
https://data.gov.il/api/3/action/package_search?q=פוליסות חיסכון
```
Then inspect each with `&limit=1` and read `result.fields` for real column names and types. **Do not assume schemas match across categories** — they don't. Write a per-category normalizer mapping raw columns to a shared internal shape:

```ts
type Fund = {
  id: string;              // stable across months
  category: 'gemel' | 'hishtalmut' | 'policy' | 'pension';
  name: string;
  company: string;         // חברה מנהלת
  track: string;           // מסלול השקעה
  managementFeeDeposit: number | null;   // דמי ניהול מהפקדה, %
  managementFeeSavings: number | null;   // דמי ניהול מצבירה, %
  returnYTD: number | null;
  return1Y: number | null;
  return3Y: number | null;
  return5Y: number | null;
  totalAssets: number | null;
  history: { month: string; return: number }[];
};
```

### Ingestion rules
- Paginate `datastore_search` with `limit=5000` until `records.length === 0` or `total` reached.
- Send a browser-like `User-Agent`; data.gov.il sits behind Cloudflare and 403s bare requests.
- Numeric fields often arrive as strings, sometimes with `%` or commas. Parse defensively; `null` on failure, never `0`.
- **Fail loudly, commit nothing on partial fetch.** A failed run must leave the previous good data in place.
- Validate output with Zod before writing. Reject a run if a category loses >20% of its funds versus the previous file — that signals a schema change upstream, not real data.
- Pre-aggregate at build time. Ship one JSON per category plus a small index; if any file exceeds ~1.5 MB, split history into a per-fund lazy-loaded file.

### Schedule
```yaml
on:
  schedule: [{ cron: '0 4 5 * *' }]   # 5th of each month
  workflow_dispatch:
```
Regulator data lands mid-month with lag; the 5th is safe. The workflow commits changed JSON, which triggers the deploy. Record `lastUpdated` and the source month in the data file and surface both in the UI.

---

## 4. Features

| ID | Feature | Notes |
|---|---|---|
| F1 | Category switcher | Four tabs/segments. Changing category resets filters. Drives the URL. |
| F2 | Fund list | Sortable by any numeric column. Default sort: 5Y return, descending. |
| F3 | Filters | Company (multi), track (multi), fee range, min assets. Filter state lives in the URL query string. |
| F4 | Fuzzy search | Fuse.js over fund + company name. Must tolerate missing niqqud, common abbreviations, partial company names. |
| F5 | Compare tray | Select up to 4 funds; persistent tray; opens a side-by-side view. Selection survives filter changes. |
| F6 | Fund detail | Full fee breakdown, all return windows, history chart, managing company. |
| F7 | Freshness indicator | Data month + last updated date, visible on every page. |
| F8 | Deep links | Every list state and comparison is a shareable URL. |

### Empty and error states
- No filter results: say which filter is excluding everything and offer to clear it.
- Missing metric on a fund: render `—` with a tooltip explaining the regulator didn't publish it. Never render a missing value as zero, and never let it sort as zero.

---

## 5. UI/UX

### Non-negotiables
- **RTL throughout.** `<html dir="rtl" lang="he">`. Use logical CSS properties (`margin-inline-start`, Tailwind `ms-`/`me-`/`ps-`/`pe-`) exclusively. No `ml-`/`pr-` anywhere.
- **Numbers stay LTR inside RTL text.** Wrap numerics in `<span dir="ltr">` or `unicode-bidi: isolate`, or percentages and dates will render reversed.
- **Hebrew webfont.** Heebo, Assistant, or Rubik. System stack renders Hebrew poorly. Self-host or use `font-display: swap`.
- **Mobile-first.** The comparison table is the hard part: on narrow screens use a stacked card layout or a horizontally scrolling table with the fund-name column pinned to the inline-start edge. Do not ship a 6-column table that requires pinch-zoom.
- Tap targets ≥ 44px. Filters open in a bottom sheet on mobile, inline sidebar on desktop.

### Visual direction
The brief is explicit that this must not look AI-generated. Before writing components, produce a short design plan (palette of 4–6 named hex values, one or two typefaces with defined roles, a layout concept) and check it against these known generated-design tells — avoid all of them:

- Cream background (#F4F1EA-ish) + high-contrast serif + terracotta accent (#D97757-ish).
- Near-black background with one acid-green or vermilion accent.
- Everything chopped into identical rounded cards with the same soft grey shadow and the same border-radius regardless of hierarchy.
- ALL-CAPS tracked-out eyebrow labels above every heading; meta strings joined with middle dots; `→` appended to button text; monospace for small data labels.
- Fade-and-slide-up entrance animation on every section; hover transitions on every card.

Ground the palette and type in the subject: a Hebrew financial-data tool for ordinary savers. Readable, calm, dense where density helps comparison. Spend boldness in one place — most likely the comparison view — and keep everything around it quiet. Use tabular figures (`font-variant-numeric: tabular-nums`) so columns of numbers align.

Motion only in response to user action: adding a fund to the tray, opening the filter sheet. Respect `prefers-reduced-motion`.

Colour must never be the only signal for positive/negative returns — pair with sign and, where useful, direction.

---

## 6. Tech

- **Framework:** Astro with React islands. Static output. (Next.js with `output: 'export'` is an acceptable substitute if the agent is more fluent in it.)
- **Styling:** Tailwind, logical properties enabled.
- **Table:** TanStack Table (headless — do not use a pre-styled table component).
- **Charts:** Recharts.
- **Search:** Fuse.js.
- **Validation:** Zod, in the ingestion script.
- **Hosting:** Cloudflare Pages (free, static, no cold starts). Vercel acceptable.
- **Repo layout:** `scripts/fetch-data.ts` → `src/data/*.json` → build.

---

## 7. Legal

Comparing retirement products in Israel borders on regulated activity. Required, visible in the footer on every page and on first visit:

- This is informational only and is **not ייעוץ פנסיוני** or ייעוץ השקעות.
- Source: רשות שוק ההון, ביטוח וחיסכון, via data.gov.il, with the data month stated.
- Past returns do not indicate future returns.
- Figures may contain errors; verify against the official גמל נט / פנסיה נט / ביטוח נט before acting.

---

## 8. Acceptance criteria

1. `npm run fetch-data` populates all four category files from live endpoints, or exits non-zero without writing anything.
2. The site builds and runs with the network disabled.
3. Every list, filter, and comparison state is reachable by URL.
4. Comparison of 4 funds is usable on a 375px viewport without horizontal zoom.
5. No physical-direction CSS properties in the codebase (lint rule enforced).
6. Missing values render as `—` and sort last in both directions.
7. Lighthouse: performance ≥ 90, accessibility ≥ 95 on mobile.
8. Full keyboard navigation with visible focus rings; comparison tray operable without a mouse.

---

## 9. Build order

1. Ingestion script + schema discovery for all four categories. Verify real data before any UI work.
2. GitHub Action + committed data files.
3. Design plan, reviewed against §5 before any component is written.
4. List + filters + search for one category.
5. Remaining categories.
6. Comparison tray and view.
7. Fund detail and history chart.
8. Legal, freshness, accessibility pass.
