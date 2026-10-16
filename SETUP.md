# Teph Seal Budgets — Setup Guide

About 30–40 minutes, one time. You'll do 3 things:
**Supabase** (database + logins) → **GitHub** (hosts the website) → **Claude Code** (future edits).

Keep this guide open next to your browser and go in order.

---

## Before you start
- Unzip `teph-seal-budgets.zip` and move the folder somewhere permanent, e.g. **Documents**.
  (Mac: double-click the zip, then drag the folder into Documents.)
- You'll need your GitHub and Supabase logins.

---

## Step 1 — Create the Supabase project (5 min)
1. Go to **supabase.com/dashboard** → **New project**.
2. Name: `teph-seal-budgets` · set a database password (save it in your password manager) · Region: **West US**.
3. Click **Create new project** and wait ~2 minutes for it to finish.

> **Free plan limit:** Supabase allows 2 active free projects. If it won't let you create one, pause the
> onboarding tracker project (its Settings → General → Pause project), then try again.

## Step 2 — Build the database (2 min)
1. In the left menu click **SQL Editor** → **New query**.
2. Open `supabase/migrations/001_initial_setup.sql` from the folder (right-click → Open With → TextEdit),
   select all, copy, and paste it into the SQL Editor.
3. Click **Run**. You should see *"Success. No rows returned."*

## Step 3 — Lock down sign-ups and create your admin login (3 min)
1. Left menu → **Authentication** → **Sign In / Providers** (may be called "Providers").
   Turn **OFF** "Allow new users to sign up" → **Save**. (Only you add people, from inside the app.)
2. **Authentication** → **Users** → **Add user** → **Create new user**.
   Enter your email + a password, keep **Auto Confirm User** checked → **Create user**.
3. Back to **SQL Editor** → **New query**, paste this (put in YOUR email) → **Run**:
   ```sql
   update public.profiles
   set role = 'admin', active = true, full_name = 'Baun'
   where email = 'YOUR-EMAIL@example.com';
   ```
   It should say *"1 row affected"*. If it says 0, the email doesn't match exactly.

## Step 4 — Add the admin tool for managing logins (3 min)
This small server function lets the People tab add people, reset passwords and lock accounts.
1. Left menu → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Name it exactly: `admin-users`
3. Delete the sample code. Paste everything from `supabase/functions/admin-users/index.ts`.
4. Click **Deploy function**. Leave "Verify JWT" ON.

## Step 5 — Connect the website to Supabase (2 min)
1. Left menu → **Project Settings** (gear) → **API Keys** (older projects: **API**).
2. Copy the **Project URL** (also shown on the project home page, looks like `https://abcd.supabase.co`).
3. Copy the **Publishable key** (`sb_publishable_…`). On older projects use the **anon public** key.
4. Open `js/config.js` in TextEdit and replace the two placeholder values. Save.

> ⚠️ Never paste the **secret** / **service_role** key into any file. The publishable key is safe to be public.

## Step 6 — Put it on GitHub (10 min)
Open **Terminal** (Cmd+Space → "Terminal").

**6a. One-time tools check.** Paste each line, press Enter:
```bash
git --version
gh --version
```
If `gh` says "command not found", install it: `brew install gh` (or download from cli.github.com).
Then sign in once:
```bash
gh auth login
```
Choose: GitHub.com → HTTPS → Yes → Login with a web browser, and follow the code it shows.

**6b. Upload the project.** Paste this whole block (it assumes the folder is in Documents):
```bash
cd ~/Documents/teph-seal-budgets
git init
git add .
git commit -m "First version of Teph Seal Budgets"
gh repo create teph-seal-budgets --public --source=. --push
```

**6c. Turn on the website.**
```bash
gh api -X POST repos/{owner}/teph-seal-budgets/pages -f "source[branch]=main" -f "source[path]=/"
```
(Or on github.com: open the repo → **Settings** → **Pages** → Source: *Deploy from a branch* → **main** / **(root)** → Save.)

After 1–2 minutes your site is live at:
**`https://YOUR-GITHUB-USERNAME.github.io/teph-seal-budgets/`**

> Why public? Free GitHub Pages needs a public repo. That's fine: only the code is public.
> Your numbers live in Supabase behind logins and security rules.

## Step 7 — First sign-in and setup (10 min)
1. Open your site, sign in with the admin email/password from Step 3.
2. **Stores tab** → check the 5 categories → **Add store** for each shop with its monthly budgets.
3. **People tab** → **Add person** for each area manager (name, email, temporary password, role).
   Text them the link + their temporary password.
4. **Stores tab** → **Edit** each store → pick its area manager.
5. **Pay tab** → pick a store → **+ Add employee** for each detailer (first name, last initial, and $/hr rate).
   Area managers can add and update employees for their own stores.
6. Tip for managers: open the site on their phone → Share → **Add to Home Screen**. It then works like an app.

---

## Step 8 — Making changes later with Claude Code
Every future change is: open Terminal → go to the folder → ask Claude → it pushes → site updates in ~1 minute.

**One-time install** (if you don't have it yet):
```bash
npm install -g @anthropic-ai/claude-code
```

**Every time you want a change:**
```bash
cd ~/Documents/teph-seal-budgets
claude
```
Then paste a prompt from **PROMPTS.md**, or just describe what you want in plain English.
Claude reads `CLAUDE.md` automatically, so it already knows how this app works and the rules to follow.

If a change needs a database update, Claude will give you SQL to paste into Supabase → SQL Editor → Run
(same as Step 2). Do that before testing.

---

## If something goes wrong
| What you see | Fix |
|---|---|
| "Almost there… add your Supabase URL" | Step 5: `js/config.js` still has placeholders, or the change wasn't pushed. |
| "Email or password is wrong" for you | Re-check Step 3. Reset your password in Supabase → Authentication → Users → ⋯ → Reset/Change password. |
| "Access paused" after you sign in | The SQL in Step 3.3 didn't match your email. Run it again with the exact email. |
| People tab: "Couldn't reach the admin service" | Step 4: function must be named exactly `admin-users` and deployed. |
| Site shows 404 | Wait 2 minutes after Step 6c; make sure Pages is set to **main** / **root**. |
| Anything else | `cd ~/Documents/teph-seal-budgets && claude` → "Something's broken: [describe it / paste the error]" |
