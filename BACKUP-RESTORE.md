# HighlightHype — Backup & Restore Runbook

Written 2026-11-04 (hardening follow-up to the security/infra review).
The site has exactly one copy of everything — the SQLite database, all
uploaded plays, and all Hype Frame print images — on a single 1 GB
Render disk at `/var/data`. These endpoints + the nightly pull below
are the fix: a second, off-site copy that Muse keeps locally.

## What lives where (on the Render disk, `DATA_DIR=/var/data`)

| Path | Contents |
|---|---|
| `highlighthype.db` | SQLite DB: plays, votes, contest, athletes, owner/moderation settings |
| `uploads/` | Uploaded play media (`/uploads/<file>` is served publicly) |
| `hype-frames/` | Hype Frame print PNGs (owner-only, never public) |

## The backup endpoints (server.js)

All three are GET, read-only, and gated by one header:

```
x-backup-token: <BACKUP_TOKEN>
```

- Auth compares the header against the `BACKUP_TOKEN` env var in
  constant time (`crypto.timingSafeEqual`).
- **If `BACKUP_TOKEN` is unset, the feature is off: every backup route
  answers 403**, token or not. A wrong/missing token also gets 403.

| Endpoint | Returns |
|---|---|
| `GET /api/backup/db` | A consistent snapshot of the live DB (server runs `VACUUM INTO` a temp file in the data dir, streams it as `highlighthype-db.sqlite`, then deletes the temp). Safe to call while the site is live. |
| `GET /api/backup/manifest` | JSON: `{ ok, generatedAt, db: { path, size }, dbSize, files: [{ path, size }] }` — every file under `uploads/` and `hype-frames/`, paths relative to the data dir, sorted. |
| `GET /api/backup/file?path=<relative path>` | Streams one file from `uploads/` or `hype-frames/`. Traversal-guarded: absolute paths, NULs, and anything resolving outside those two directories (including the DB file itself) are refused with 400/403. |

## One-time setup (Emil)

1. In the Render dashboard → the `highlighthype` service → Environment,
   add `BACKUP_TOKEN` with a long random value (a password generator's
   32+ character string is perfect). The service restarts on save.
2. Store the **same value** in Muse's Secure Vault so the nightly
   job can use it. **Never paste it into chat** — Muse never sees or
   types the token; the pull job reads it from the vault at run time.
3. Recommended at the same time: set `OWNER_TOKEN` in the Render env
   (a value from the owner's device claim). This closes the
   first-come owner-claim window if the DB is ever reset/restored.

## Nightly pull (Muse, planned cron)

Target: `~/workspace/projects/highlighthype-backups/<YYYY-MM-DD>/`

1. `GET /api/backup/db` → save as `highlighthype-db.sqlite`.
2. `GET /api/backup/manifest` → save as `manifest.json`.
3. For each entry in `files` whose path/size is new or changed vs. the
   previous night's manifest: `GET /api/backup/file?path=<path>` →
   save under the same relative path.
4. Verify: the DB file starts with `SQLite format 3`, its size is
   within a sane band of `dbSize`, and every manifest file exists
   locally with a matching size.
5. Retention: keep 30 days, then delete older dated folders.
6. Any failure (403, size mismatch, unreachable) is reported to Emil
   in the morning briefing — a silent backup failure is the one
   outcome this exists to prevent.

## Restore (onto a fresh Render service/disk)

1. Create/redeploy the service from the GitHub repo; attach a 1 GB
   disk mounted at `/var/data`; set env vars: `DATA_DIR=/var/data`,
   `NODE_VERSION`, SMTP vars, and `OWNER_TOKEN` + `BACKUP_TOKEN`
   (values from the vault / owner's device).
2. Stop the service (or restore before first public traffic) and place
   the backup into the disk's data dir:
   - `highlighthype-db.sqlite` → `/var/data/highlighthype.db`
   - `uploads/` → `/var/data/uploads/`
   - `hype-frames/` → `/var/data/hype-frames/`
3. Start the service.

## Restore-test checklist (run after every restore, and once now)

- [ ] `GET /api/health` → `{ ok: true }`
- [ ] Homepage loads; the board shows the expected approved plays
- [ ] One uploaded media file plays from `/uploads/...`
- [ ] Owner view opens with the owner token; the queue matches the DB
- [ ] Moderation link from a fresh `/api/moderate/request` email works
- [ ] A Hype Frame print image loads in Owner view (owner-authorized)
- [ ] `GET /api/backup/manifest` (with token) lists the restored files
      and a plausible `dbSize`; without the token it answers 403
- [ ] Response headers include HSTS, `nosniff`, `Referrer-Policy`,
      and `Content-Security-Policy: frame-ancestors 'self'`

## Notes

- The snapshot endpoint never serves the live DB file directly —
  `VACUUM INTO` guarantees a consistent copy even mid-traffic, and the
  temp snapshot is deleted as soon as the download finishes.
- Backups contain guardian contact details (they are a full DB copy).
  The local backup folder is private workspace storage; treat it like
  the moderation links — never share or forward it.
