# Teph Seal Budgets — notes for Claude Code

Read this before changing anything. The owner (Baun, Market President, Utah, 11 shops) is not a developer:
explain changes in plain English, keep answers short, and do the git work for him.

## What this is
Mobile-first budget app for Teph Seal area managers. Each store has a monthly budget per category
(Extra Pay, SPIFF, Equipment, Supplies, Chemicals — editable in-app). Managers log purchases; admins
see the whole market, edit budgets, manage people, and move money between stores for a month.

## Stack (keep it this simple)
- Static site on **GitHub Pages**: `index.html`, `css/styles.css`, `js/config.js`, `js/app.js`.
  No build step, no npm packages, no frameworks. Plain JS in one file with numbered sections.
- **Supabase**: Postgres + Auth (email/password) + one Edge Function.
  - `supabase/migrations/NNN_*.sql` — every database change, in order. 001 is the initial setup.
  - `supabase/functions/admin-users/index.ts` — admin-only: create user, reset password, lock/unlock, delete.
- supabase-js is loaded from jsDelivr pinned at 2.45.4 in `index.html`.

## Data model
- `profiles` (id = auth user id, email, full_name, role: admin|district|manager, can_move, active)
- `categories` (name, sort, archived, pays_people) — "removing" sets archived=true; never hard-delete.
  pays_people=true categories (Extra Pay, SPIFF) are logged on the Pay tab; the rest on the Purchases tab.
- `stores` (name, manager_id → profiles)
- `store_budgets` (store_id, category_id, amount) — monthly budget, same every month
- `employees` (store_id, first_name, last_initial, rate $/hr, active) — FIRST NAME + LAST INITIAL ONLY, never full names,
  SSNs, or bank info. Managers add/edit employees for their own stores; admin for all.
- `spend` (store_id, category_id, item, vendor, amount, spent_on, employee_id, employee_name, hours, rate, created_by)
  — for pay in hours, amount must equal round(hours × rate, 2) (database check).
- `moves` (month = first day of month, category_id, from_store, to_store, amount, note, created_by)
- Effective budget for a store/month = store_budgets + moves in − moves out (computed in `budgetOf` in app.js).

## Pay screen
`vPay()` in app.js (section 4b): store → employee tiles → Hours/Dollars → quick buttons → reason → big Add button.
Quick button values and reasons are the QUICK_HOURS, QUICK_DOLLARS, PAY_REASONS lists at the top of app.js.
Keep it thumb-friendly: buttons at least 46px tall, inputs 16px+ font (stops iPhone zoom).

## Security rules (Row Level Security) — do not weaken
- Admin: everything. District: sees all stores, cannot edit setup. Manager: sees money only for stores
  where `stores.manager_id = them`, can log spend to ANY store, can move money only between their own
  stores and only if `can_move`.
- Locked users (`active = false`) see nothing; the edge function also bans them in Auth.
- Helper SQL functions: `my_role()`, `is_member()`, `is_admin()`, `sees_all()`, `manages(store)`, `can_move_money()`.
- Any NEW table must get `enable row level security` plus policies in the same migration.

## How to make a change
1. Make the edit. Keep the existing look (CSS tokens at top of styles.css, light + dark).
2. If the database must change: create the next file `supabase/migrations/00N_short_name.sql`
   (never edit 001). Then tell Baun clearly:
   "Paste this into Supabase → SQL Editor → New query → Run" and show the SQL in a code block.
   If the edge function changed, tell him to re-paste it in Supabase → Edge Functions → admin-users → Code → Deploy.
3. Test locally if useful: `python3 -m http.server 8000` then open http://localhost:8000
   (it uses the real Supabase data, so be careful with test entries).
4. Summarize the change in 1–3 plain sentences, then ask: "Want me to publish it?"
5. On yes: `git add -A && git commit -m "<plain description>" && git push`.
   Tell him the site updates in about a minute (hard refresh on phone if needed).

## Never
- Never put the Supabase secret/service_role key in any frontend file or commit it.
- Never disable RLS or add a policy like `using (true)` for writes.
- Never delete spend history to "fix" totals; use archive flags or new migrations.
- Never add a build tool, framework, or paid service without asking.

## Undo
- Last change not pushed yet: `git restore .`
- Already pushed: `git revert HEAD --no-edit && git push`
