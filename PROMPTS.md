# Copy-paste prompts for Claude Code

**How to use:** open Terminal and paste:
```bash
cd ~/Documents/teph-seal-budgets && claude
```
Then copy one of the prompts below, fill in the [brackets], and paste it in.
Claude will make the change, explain it, and ask before publishing.

---

## Everyday tweaks
- `Change the "Watch" warning so it kicks in at [85]% of budget instead of 90%.`
- `Rename the app to "[New Name]" everywhere.`
- `Change the main accent color to [#C8102E] (our brand red) in light and dark mode.`
- `On the Log screen, make [Supplies] the default category instead of the last one used.`
- `Make the store list sort alphabetically instead of by who is closest to over budget.`
- `Add a "Notes" field to each store that only admins can edit and everyone can see.`

## Pay screen
- `Change the quick hour buttons on the Pay screen to [0.25, 0.5, 1, 1.5, 2, 3].`
- `Add "[Detail upsell]" as a reason button on the Pay screen.`
- `Show each employee's total extra pay for this month on their button.`
- `Add a monthly report of extra pay by employee that I can export to CSV.`
- `Let employees have two rates: hourly and flat rate, and let me pick which one when logging hours.`

## New features
- `Let managers attach a photo of the receipt when logging a purchase. Store photos in Supabase Storage, admins and the store's manager can view them.`
- `Add a yearly view that shows each store's budget vs spend for every month this year.`
- `Let me set a different budget for a specific month (for example, a bigger Chemicals budget in [December]) without changing the normal monthly budget.`
- `Add a "pending approval" step: purchases over $[500] need my approval before they count.`
- `Add a weekly summary email to me every Monday with each store's % used.`
- `Add a new role called "[Shop Manager]" that can log purchases for one store only and see only that store.`
- `Show a comparison to last month on each store card.`

## People & access
- `Add a "last signed in" date to the People tab.`
- `Let district managers also edit budgets, but not manage people.`

## Fixes
- `Something's broken: [describe what you see, or paste the error message]. Find the cause and fix it.`
- `On my phone, [the Log button is hard to tap]. Fix the layout for small screens.`
- `The numbers for [Sandy] look wrong this month. Walk me through how the total is calculated and check for a bug.`

## Safety net
- `Undo the last change you published.`
- `Show me the last 10 changes made to this app in plain English.`
- `Before I add [feature], tell me what it would change and whether it needs a database update.`

## Data
- `Write me the SQL to export all of [October]'s purchases with store and manager names, so I can run it in Supabase.`
- `Write the SQL to copy every store's current budgets up by [3]% for next year. Don't run anything; just give me the SQL and explain it.`

---

### Tips
- Be specific about **who** should see or do something (admin, district, area manager).
- One change at a time is easiest to check and undo.
- If Claude gives you SQL, run it in Supabase → **SQL Editor** → **Run** before testing the site.
