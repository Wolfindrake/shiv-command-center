# Command Center (GitHub Pages mirror)

A static, auto-refreshing, standalone mirror of "Shiv's Command Center" dashboard — same
Cyber-Luxe bento design as the live claude.ai version, no Claude account needed to view it.
A scheduled GitHub Action pulls your Todoist tasks and Google Calendar events, writes
`site/data/data.json`, and republishes the page to GitHub Pages — no server, no database,
just this repo.

**This repo is public**, by your own choice, because GitHub Pages doesn't serve a private
repo on the free plan. That means `site/data/data.json` — your real task text, project
names, and deadline descriptions — is committed into git history every refresh, and the
published page itself is a public URL: anyone who has the link can open it, no login
required. Your API token and calendar URL stay out of the repo entirely (see step 3 below),
but the schedule and task content themselves are not private once this is live.

The live version with real-time data and synced checkmarks lives in your Claude Project as
a published Artifact. This repo exists so you have a plain URL that updates on its own
without opening Claude — think of it as the public-facing mirror, not the private one.

## One-time setup

### 1. Get a Todoist API token

Todoist web app → **Settings → Integrations → Developer** → copy your personal API token.

### 2. Get your Google Calendar's secret iCal address

For your **primary calendar** (`singhshivendra718@gmail.com`):
Google Calendar → the gear icon → **Settings** → click your calendar's name under
"Settings for my calendars" → scroll to **Integrate calendar** → copy
**Secret address in iCal format**.

This URL has a secret token baked into it — treat it like a password. Anyone with the URL can
read every event on that calendar.

For the **"My IE Agenda"** feed (optional, needed for the deadline cards and class schedule):
that calendar was itself added to your Google Calendar as an imported/subscribed feed, so it may
not expose its own secret iCal address the same way. If Google Calendar's settings page for it
doesn't show one, you'll need the original feed URL from wherever IE gave it to you (their student
portal, an email, or a calendar-subscription link) — or skip this one for now; the dashboard runs
fine without it, it just won't show deadlines or your class timetable.

### 3. Add them as repository secrets

In this repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Secret name | Value |
|---|---|
| `TODOIST_API_TOKEN` | the token from step 1 |
| `GCAL_PRIMARY_ICS_URL` | the secret iCal URL from step 2 |
| `GCAL_IE_ICS_URL` | (optional) the IE feed's URL, if you found one |

Never paste these into a commit, an issue, or anywhere else in the repo itself — only into the
Secrets form. They stay encrypted and are only ever exposed to the workflow run, never in logs.

### 4. Turn on GitHub Pages

**Settings → Pages → Build and deployment → Source: GitHub Actions.** (If this repo was created
for you with Pages already set to "GitHub Actions", you can skip this.)

### 5. Run it once

**Actions tab → "Refresh dashboard data and deploy" → Run workflow.** After it finishes, your
site is live at the URL shown on the **Settings → Pages** screen (usually
`https://<your-username>.github.io/<repo-name>/`).

## After that

It refreshes automatically every 6 hours (edit the `cron` line in
`.github/workflows/update-data.yml` to change that). You can also trigger a refresh any time from
the Actions tab.

## What this version can't do that the live Claude version can

- No live query on open — it shows whatever the last scheduled run fetched, up to ~6 hours old.
  The refresh pill at the top turns amber if it's been longer than that, which usually means
  the scheduled run failed — check the Actions tab.
- Checkmarks save to **this browser only** (`localStorage`), not synced anywhere. Check
  something off on your laptop and it'll still show as open on your phone — there's no
  account or database behind this version the way the Claude artifact has.
- If a secret is missing or wrong, the workflow run will fail — check the Actions tab's run log
  for which one.
