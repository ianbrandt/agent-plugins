# Two-factor sign-in

## Analysis

Agents sign in to the support desk app with an email and a password. Three customer workspaces lost
accounts to reused passwords last quarter, and two of the largest customers ask for a way to
require a second factor. The app is a Next.js project on PostgreSQL. Sessions are signed cookies,
issued in `src/auth/session.ts`.

## Plan

Five items, each landed on `main` on its own. Every item runs unattended in the build pipeline: an
agent builds it in its own worktree and lands it when its check passes. An item starts as soon as
every item it is gated on has landed, so items whose gates are met run in parallel.

### R1. Codes and secrets

Add the `totp_secrets` and `recovery_codes` tables, and `src/auth/totp.ts` with functions to create
a secret, check a six-digit code against it with one step of clock drift, create ten single-use
recovery codes, check one, and delete a user's secret and codes. Each wrong code is recorded in the
user's `totp_secrets` row.

- Gated on: nothing.
- Files: `db/migrations/0040_two_factor.sql`, `src/auth/totp.ts`, `src/auth/totp.test.ts`.
- Done when: the tests pass against the RFC 6238 test vectors.

### R2. Enrollment

A page at `/settings/security` shows a QR code for a new secret, asks for one code to confirm it,
and then shows the recovery codes once. `confirmEnrollment` is added to `src/auth/totp.ts`.

- Gated on: R1.
- Files: `app/settings/security/page.tsx`, `src/api/two-factor.ts`, `src/auth/totp.ts`.
- Done when: a Playwright test enrolls a new user, reading the secret from the page and computing
  the code.

### R3. Sign-in challenge

After a correct password, a user with a confirmed secret gets a session marked as waiting for a
second factor and is sent to `/sign-in/challenge`, which takes a code or a recovery code. The check
in `src/auth/totp.ts` refuses every code for 15 minutes after five wrong ones.

- Gated on: R1.
- Files: `src/auth/session.ts`, `src/auth/challenge.ts`, `app/sign-in/challenge/page.tsx`,
  `src/auth/totp.ts`.
- Done when: Playwright tests sign in with a code and with a recovery code, and a sixth wrong code
  within 15 minutes is refused.

### R4. Workspace controls

Workspace admins can require two-factor sign-in. Members of such a workspace who have no confirmed
secret are sent to `/settings/security` at their next sign-in until they enroll. Admins get a page
listing which members have enrolled, with a CSV export, and can reset a member's second factor.
Every sign-in, wrong code, policy change, and reset is written to a new audit log, which admins can
search by member and date and export. Members get an email when their second factor is reset or the
policy of their workspace changes.

- Gated on: R3.
- Files: `db/migrations/0041_workspace_security.sql`, `src/auth/session.ts`,
  `src/auth/challenge.ts`, `src/api/admin/two-factor.ts`, `src/api/admin/audit-log.ts`,
  `src/audit/log.ts`, `app/admin/security/page.tsx`, `app/admin/audit-log/page.tsx`,
  `src/email/templates/security-event.mjml`, `src/email/send.ts`.
- Done when: Playwright tests cover the policy, the forced enrollment, the member list and export,
  the reset, the audit log search and export, and each email.

### R5. Security keys

Users can register hardware security keys at `/settings/security-keys` and use one instead of a
code at the challenge. Registrations and removals are written to the audit log.

- Gated on: R4.
- Files: `db/migrations/0042_security_keys.sql`, `src/auth/webauthn.ts`,
  `app/settings/security-keys/page.tsx`, `app/sign-in/challenge/page.tsx`, `src/auth/challenge.ts`.
- Done when: two security keys of different makes each register and sign in on Chrome, Safari, and
  Firefox, on macOS and Windows.
