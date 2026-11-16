# Athlete profiles, My Highlights, and prize notification — implementation plan

Status: proposed; NOT live. Privacy/security review required before public launch.

## Decisions
- Each athlete has a random, opaque, immutable athlete ID (UUID); never use name as key. Names may duplicate. Public display defaults to first name or parent-approved nickname only; do not publish full names, school, location, exact age, or contact details.
- Parent/guardian-managed accounts only. Athlete profiles and associated video collections are PRIVATE by default. No child login, child email collection, or public directory in first release.
- Parents can view videos linked to their verified athlete; uploaded-by-family and featuring-athlete are distinct relationships.
- Parents can request incorrect-tag corrections, remove associations, revoke sharing, and request deletion.
- No automatic facial recognition or identity inference. Athlete-to-video tagging is explicit and moderated.

## Proposed data model
- guardians(id UUID, email encrypted/secured, email_verified_at, auth_provider_subject, created_at)
- athletes(id UUID, display_name, division_optional, visibility DEFAULT 'private', created_at)
- guardian_athletes(guardian_id, athlete_id, relationship, verification_status, verified_at)
- highlight_athletes(highlight_id, athlete_id, tagging_status, tagged_by_guardian_id, reviewed_at, UNIQUE(highlight_id, athlete_id))
- privacy_requests(id, guardian_id, athlete_id, highlight_id nullable, type, status, created_at, resolved_at)
- prize_claims(id, contest_period, highlight_id, guardian_id, contact_status, claim_token_hash, expires_at, fulfilled_at)
- audit_log(id, actor_id, action, target_type, target_id, created_at)

Use encrypted storage and retention limits for contact/shipping data. Do not put shipping addresses in public highlight records.

## API and authorization (future work)
- GET /api/me/athletes: guardian-authenticated; list only verified linked athletes.
- GET /api/me/athletes/:id/highlights: guardian-authenticated; verify ownership for every request; list approved and guardian-accessible highlights only.
- POST /api/me/athletes/:id/tag-requests: guardian-authenticated; queue for moderation.
- POST /api/me/athletes/:id/privacy-requests: guardian-authenticated; queue correction/unlink/deletion.
- POST /api/admin/contest/:period/notify-winner: staff authenticated with proper role; send a single-use, expiring prize claim link to VERIFIED guardian email; audit notification and claim; never expose email in public API.
- POST /api/prize-claims/:token: verify single-use token, guardian identity and eligibility; collect minimal shipping details via secure authenticated form.
- All endpoints require real server-side session/auth, CSRF/rate limits where applicable, strict per-object authorization, and audit logging. Existing browser localStorage owner token is NOT sufficient.

## UI
- Parent dashboard: My Athletes, My Highlights, Request Correction, Sharing Controls, Delete/Privacy Request.
- Athlete chooser uses nickname + parent-visible internal ID suffix; never expose full IDs in public pages.
- Contest dashboard: winner selection, eligibility verification, guardian contact status, claim expiration, shipment confirmation.
- Clear consent copy and no public athlete search until reviewed and explicitly enabled.

## Rollout
1. Legal/privacy review: COPPA, video consent, NY giveaway/sweepstakes rules, age/eligibility, official rules and parental consent verification.
2. Replace beta owner-token gate with real account and staff authentication.
3. Add migrations and guarded backend APIs; test two athletes with identical names, unauthorized access, unverified guardian, tag removal, privacy deletion, prize-token replay and expiration.
4. Add parent dashboard UI and moderation tools.
5. Stage/test with synthetic accounts; launch only after owner approval.

## Existing implementation notes
Current server.js stores highlights.player_name as free text and optional notify_email. These are NOT verified athlete IDs or verified parent contacts. Current public/app.js uses browser-local voter/owner tokens. Do not treat these as secure accounts. Existing contest winner endpoint does not implement verified guardian prize notification.

No automatic migration of legacy player_name strings into verified athlete identities. Legacy records require manual review and parent confirmation.

## Parent notification center — email and optional SMS (planned)
- Verified parent/guardian accounts may configure email and SMS independently. Email is the first-release baseline; SMS is a later opt-in rollout after provider, compliance, and security checks.
- Events: video moderation decisions; new athlete-tag requests awaiting guardian approval; monthly prize winner and secure claim reminders; security alerts; optional apparel announcements.
- Marketing SMS consent is separate, optional, recorded with timestamp/source/disclosure version, and never a condition of account use or contest eligibility. Operational SMS requires its own appropriate consent and clear opt-out controls.
- Verify phone ownership before use; store normalized phone numbers securely and restrict access. Never contact children directly.
- Support STOP/HELP, suppression lists, quiet hours, rate limits, delivery failures, and provider webhooks; respect opt-outs across all send paths.
- Texts must avoid sensitive athlete details, private video links, and shipping addresses. Link to authenticated account pages instead.
- Prize claim requires authenticated guardian confirmation and an expiring, single-use token; an SMS alone must never authorize prize fulfillment.
- Proposed schema: guardian_phones(guardian_id, phone_encrypted, verified_at); notification_preferences(guardian_id, event_type, email_enabled, sms_enabled); notification_consents(guardian_id, channel, purpose, disclosure_version, captured_at, revoked_at); notification_deliveries(id, guardian_id, event_type, channel, provider_message_id, status, created_at).
- Evaluate an SMS provider (e.g. Twilio), US A2P/10DLC registration as applicable, TCPA and carrier requirements, COPPA/privacy implications, message costs, and retention policies before enabling.
- Tests: duplicate notifications, opt-out enforcement, unverified numbers, expired prize links, unauthorized preference changes, provider errors, and child-data leakage in message content.
