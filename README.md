# HighlightHype — Deployable Private-Beta Build

A standalone copy of HighlightHype, built to run on real hosting so Dyanna and
Nicholas (and other beta testers) can open it on their own phones. This is a
**code build only**: nothing has been bought, no DNS has been changed, no
accounts have been claimed, and no credentials were used.

**Brand:** HighlightHype · Official handle: **@HighlightHype_Official**
(plain @HighlightHype is taken on Instagram, TikTok, and YouTube.)
**Domain (already bought by Emil, separately):** highlighthype.com — it is
*not* pointed at anything yet. Do not point it until the new site is tested.

## What this build does

- **Plays:** upload a video/photo file *or* paste a video link (YouTube/Vimeo
  etc. embed in an iframe; direct .mp4/.webm play inline; other hosts show a
  big "Watch on [host]" link). Title, sport, play type, player name, story.
- **Voting:** one vote per browser per play, tap again to remove. Live
  leaderboard with a Top 3 podium, sport filters, Top/Newest sorting, search.
- **Hype of the Month contest:** one cross-sport monthly leaderboard. An
  approved play can be entered once per month; votes on the main board count
  in the contest. Winner marking is owner-only.
- **Private-beta lockdown:** every new play starts **pending** in a moderation
  queue and is *not* public until the owner approves it. The owner can
  approve / hide / restore / delete, and sees a reports list. Any visitor can
  report a play. A Private Beta banner states the rules: own clips only,
  parent permission under 13, first names only, no DMs.
- **Swag Store — PARKED preview, no real payments:** Drop 001 at
  BL101-aligned prices — Hype Starts Here tee **$32**, Don't Believe The Hype
  tee **$32**, Hype All Day hoodie **$65**, HH snapback **$35**, Hype All Day
  cap **$32**, sticker 6-pack **$12**. Cart (youth + adult sizes, quantity
  controls) is saved in the visitor's browser only. Shipping is $4.99 under
  $50, free at $50+. The checkout button is disabled and says checkout opens
  at launch. No payment is taken, no order is sent anywhere.
- **Starts empty:** no fake plays, no fake votes, no seeded contest entries.

## ⚠️ Migration note — please read

**The existing prototype's "Nick Home Run" video cannot be auto-migrated.**
Prototype data lives in the private Muse artifact and is not copied here.
After the new site is live, re-upload Nick Home Run on the new site (it will
go into review first — approve it in Owner view), then enter it in Hype of
the Month again. Its old vote does not carry over either; that is a fresh
start, by design, so the live site never shows a vote nobody cast there.

## Stack chosen — and why

**Single Node.js app, zero dependencies, SQLite + files on disk.**

- `server.js` — one file: HTTP server, API, SQLite database, file uploads.
  Uses Node 22+'s built-in `node:sqlite`, so there is nothing to install
  and no build step. If a dependency ever breaks, this app does not care.
- `public/` — plain HTML/CSS/JS front end (no framework, no build).
- Data lives in `DATA_DIR/highlighthype.db`; uploads in `DATA_DIR/uploads/`.
- `render.yaml` — one-click Render blueprint (recommended). `Dockerfile`
  is included for Railway / Fly.io / any Docker host.

Why not a bigger stack? A kids' beta with a handful of testers does not need
a separate database service, a video-transcoding pipeline, or a frontend
framework — and every extra service is another bill and another failure
point. This app is one process you can actually understand and move.

## Run it on your own computer first (optional, 2 minutes)

You need Node.js 22 or newer (download it from nodejs.org if you do not
have it — it is free).

```
cd highlighthype-hosting
node server.js
```

Open http://localhost:3000. Post a play, approve it in Owner view, vote,
enter the contest. To run the automated checks:

```
node test.js
```

Expected output ends with `ALL TESTS PASSED`. Test data is thrown away
afterwards; it never ships to the live site.

## Deploy — recommended: Render (free to start)

You will need: a Render account (free, sign up with your email), and this
code in a GitHub repository (Render deploys from GitHub — see step 2).

1. **Put the code on GitHub.** Create a free GitHub account if needed.
   Create a new repository called `highlighthype`, then upload this whole
   folder (or, if you use git: `git init`, `git add .`, `git commit`,
   push to that repository). Do **not** upload the `data/` folder — it is
   empty and is ignored by `.gitignore`.
2. **Create the service on Render.** Sign in to Render → New → Web Service
   → connect the `highlighthype` repository. Or use the blueprint: New →
   Blueprint, point it at the repository, and Render will read
   `render.yaml` for you.
3. **Settings Render should pick up:** Environment: Node. Build command:
   `npm install --omit=dev || true`. Start command: `node server.js`.
   If Render asks for a Node version, use 24.
4. **Persistent disk — important.** The blueprint already asks for a 1 GB
   disk mounted at `/var/data`, and sets `DATA_DIR=/var/data`. **Do not
   skip this.** Without a disk, Render's free tier wipes uploads, votes,
   and the database on every restart. With the disk, they survive.
5. **Owner token (recommended, optional).** In Render → Environment, add
   `OWNER_TOKEN` with a long random string you invent (e.g. 30+ random
   letters/numbers — keep it private, like a password). If you set it, the
   site's "Claim owner access" button will *not* work; instead, paste
   that token into Owner view's "Owner token" box on your device (see
   "Claiming owner access" below). If you do *not* set it, the first
   person to open the site and click "Claim owner access" becomes the
   owner, so claim it yourself immediately after deploy.
6. **Deploy and test.** Click Deploy. When Render gives you a temporary
   address like `https://highlighthype.onrender.com`, open it, claim owner
   access, post a test play, approve it, vote, enter the contest, and check
   the Swag Store. Only move on when that all works.

### Other hosts (if you prefer them)

- **Railway:** New Project → Deploy from GitHub → pick the repository.
  Add a Volume and set `DATA_DIR` to the volume's mount path. Same start
  command (`node server.js`), same `PORT` handling (Railway sets `PORT`
  for you).
- **Fly.io:** `fly launch` with the included `Dockerfile`, then
  `fly volumes create` and mount it at `/app/data` (the Dockerfile already
  uses `DATA_DIR=/app/data`).
- In every case: the app listens on the `PORT` environment variable the
  host gives it, and stores data in `DATA_DIR`.

## Point highlighthype.com at the new site (only AFTER testing)

1. In Render (or your host), go to Settings → Custom Domains → add
   `highlighthype.com`. Render will show you the DNS records it needs —
   usually an `A` record (an IP address) for the bare domain and/or a
   `CNAME` record for `www`.
2. In Namecheap → Domain List → highlighthype.com → Manage → Advanced DNS,
   add exactly the records Render shows you. Delete any conflicting old
   `A`/`CNAME` records for `@` and `www` first, if Render says so.
3. Wait for DNS to spread (minutes to a few hours). Render issues the SSL
   certificate (the padlock / `https://`) automatically once DNS points
   at it — you do not buy SSL separately.
4. Open https://highlighthype.com and repeat the test from step 6 above.
   Only then send the link to Dyanna, Nicholas, and other beta testers.

## Claiming owner access

- **If `OWNER_TOKEN` is set in the host:** open the site → Owner view →
  paste that exact token into "Owner token" and click "Save owner token
  on this device". Owner controls will then work from that browser.
- **If `OWNER_TOKEN` is not set:** open the site on the device you want to
  be the owner device → click **Owner view** → **Claim owner access on
  this device**. The token is generated once, shown once, and saved in
  that browser automatically. **Do not clear that browser's site storage,**
  or owner controls will stop working there and a new owner cannot be
  claimed (the site will say "Owner already claimed").
- Owner view lets you: approve / hide / restore / delete plays, see
  reports, and mark the Hype of the Month winner.

## Environment variables

| Variable | Required? | What it does |
|---|---|---|
| `PORT` | No — hosts set it | Port the app listens on (default 3000). |
| `DATA_DIR` | No — default `./data` | Where the SQLite database and uploads live. Set it to your persistent disk/volume path on the host. |
| `OWNER_TOKEN` | No, recommended | If set, this is the owner token (its hash is what the server checks). If unset, the first claim wins. |
| `NODE_ENV` | No | Set to `production` on the host (the Dockerfile does this). |

## Costs to expect

- Domain: already bought separately by Emil (highlighthype.com).
- Render free tier: $0 to start, with the disk caveat above (free-tier
  services can sleep when idle, so the first visit after a pause may be
  slow — that is normal, not broken). A paid Render instance removes the
  sleep and is the usual next step if the beta grows.
- No other bills from this app: no database service, no video service,
  no paid dependencies.

## Limitations — honest list, do not skip before beta

1. **Owner token is a private-beta gate, not real login security.** There
   are no user accounts or passwords. Anyone with the owner token (or
   with the owner's device) can moderate. Real account login is required
   before any public launch.
2. **One vote per browser, not per person.** Votes are tied to a random
   token in the visitor's browser. A determined person could vote from
   another browser/device. For a family/team beta this is fine; for a
   public contest it is not — account-based voting is a public-launch
   upgrade.
3. **No video transcoding.** Uploaded videos play natively. iPhone .MOV
   (HEVC) files may not play in every browser — MP4 uploads are the most
   reliable. Transcoding to MP4 on upload is a later upgrade, not in
   this build.
4. **No email notifications.** There is no "your play was approved" email
   and no moderation email alert — the owner checks Owner view.
5. **Ephemeral filesystem warning.** If the host is run *without* a
   persistent disk/volume, uploads and votes will be lost on restart.
   Always deploy with the disk (Render blueprint) or volume (Railway/Fly).
6. **File size cap is 120 MB per upload**, enforced by the server.
7. **Swag Store takes no money.** It is a preview with a cart. Real
   checkout (Shopify + Printful) is a separate, later step — it was
   deliberately parked by Emil and is not wired into this app.
8. **No analytics, no ads, no tracking of kids.** Deliberately. Do not add
   ad trackers to a kids' app.

## Files in this folder

```
server.js        — the whole back end (API + SQLite + uploads)
public/index.html, styles.css, app.js — the whole front end
package.json     — Node metadata (zero dependencies)
render.yaml      — Render blueprint (web service + persistent disk)
Dockerfile       — Docker image for Railway / Fly.io / other hosts
test.js          — automated end-to-end test (scratch data only)
TEST_REPORT.md   — what the local test run proved
README.md        — this file
```
