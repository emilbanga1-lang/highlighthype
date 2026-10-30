# Local test report — HighlightHype deployable build

Date: 2026-10-30 (local run, scratch data only — nothing from this run ships)

## Command

```
cd ~/workspace/projects/highlighthype-hosting
node test.js
```

## Result: ALL TESTS PASSED (23 checks)

Proved, against a real running server on a throwaway database:

1. Health endpoint responds.
2. A new play (YouTube link) starts **pending**.
3. A pending play is **not** on the public board.
4. Entering the contest while pending is **refused**.
5. Owner claim returns a token **once**; a second claim is refused (409).
6. Moderation queue **requires** the owner token (403 without it).
7. Owner queue lists the pending play.
8. Owner approval makes the play public.
9. Vote counts on first tap.
10. Second tap **removes** the vote (toggle works).
11. Contest entry succeeds after approval.
12. Duplicate contest entry for the same month is refused.
13. Contest leaderboard shows the entry with its vote count.
14. Winner marking **requires** the owner token (403 without it).
15. Owner marking a winner succeeds.
16. Winner badge appears in the contest list.
17. Reporting a play succeeds.
18. Owner sees the report.
19. Owner hiding a play works.
20. A hidden play leaves the public board.
21. File upload (PNG, multipart) creates a pending play.
22. `node --check` passes for `server.js` and `public/app.js`.
23. Smoke check: homepage serves HighlightHype branding, the
    @HighlightHype_Official handle, and the Private Beta banner;
    `/api/health` returns `{"ok":true}`; Swag prices in code are
    32 / 32 / 65 / 35 / 32 / 12.

## What was NOT tested locally

- Real hosting deploy (Render/Railway/Fly) — that needs Emil's hosting
  account, which was out of scope for this code-only build.
- DNS pointing and SSL for highlighthype.com — nothing changed there.
- Real iPhone .MOV upload/playback in a phone browser — the server
  accepts and serves .MOV, but HEVC decoding varies by browser (see
  README limitations). MP4 is the reliable format.
- Owner-token entry UI flow in a browser (the API for it is tested;
  the paste-and-save box was added after the API run and syntax-checked).
