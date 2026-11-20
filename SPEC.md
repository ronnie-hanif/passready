# passready — SPEC (v0.1)

## Problem

When Microsoft retires Microsoft-provided SMS/voice MFA in Entra ID
(1 Feb 2027 for most users, 1 Jul 2027 for Global Admins and external users),
every SMS/voice-only user hits a blocking passkey-registration prompt.
IT teams need a per-user blocker list — not a tenant percentage — early enough
to act: register passkeys, issue security keys, fix devices, and decide on the
paid telephony-provider exception before it can even be configured
(from 30 Oct 2026).

## Design principles

1. **Export-first, read-only.** v0.1 consumes CSV exports only. No Graph API,
   no tokens, no stored secrets, no writes anywhere.
2. **Pure rules engine.** All classification logic lives in `src/rules.ts` as
   pure functions, unit-tested per cohort. I/O (CSV, files, terminal) is at
   the edges (`src/csv.ts`, `src/report.ts`, `src/cli.ts`).
3. **Assumptions are labelled, not hidden.** Every heuristic is numbered
   (A1–A5, below and in `rules.ts`) so a reviewer can disagree precisely.
4. **Rules are versioned by the vendor timeline.** `RULES_VERSION = "2026.1"`
   is bound to the Microsoft dates in `DATES`. If Microsoft moves a date,
   the version bumps and the tests re-run.

## Data model

### Input: auth-methods export (`UserAuthRecord`)

| Field | Type | Source column |
| --- | --- | --- |
| userPrincipalName | string | `userPrincipalName` |
| displayName | string | `displayName` |
| manager | string | `manager` |
| userType | `member \| external \| internalGuest \| unknown` | `userType` |
| isGlobalAdmin | boolean | `isGlobalAdmin` |
| requiresSmsVoice | boolean | `requiresSmsVoice` (see A4) |
| methods | string[] | `methods` (`;`- or `\|`-separated) |

### Input: device export (`DeviceRecord`, optional)

`userPrincipalName, deviceName, os, osVersion, authenticatorInstalled`.
0..n rows per user. If the file is not supplied, device state is `unknown`
(`hasCapableDevice = null`) and no device blocker is emitted.

### Output: `UserResult`

`{ user, cohort, deadline, blockers[], hasCapableDevice, recommendedAction }`

Cohorts: `passkey-ready`, `feb-2027-blocked`, `jul-2027-blocked`,
`telephony-exception-candidate`, `not-blocked-not-ready`.
Blockers: `no-passkey-or-fido2-method`, `sms-voice-only`,
`no-mfa-methods-registered`, `no-device-data`, `no-capable-device`,
`no-authenticator-on-device`.

Outputs: `blockers.csv` (per-user), `manager-summary.csv` (per-manager
cohort counts), `report.md`, plus a terminal summary.

## Rules (summary — normative text is `src/rules.ts`)

Method sets (matched after normalisation, A1):

- **Phishing-resistant:** passkey, FIDO2 security key, Windows Hello for
  Business, Microsoft Authenticator passkey, certificate-based auth.
- **Telephony:** sms, voice (and common token variants).

Cohort precedence (first match wins):

1. Has a phishing-resistant method → `passkey-ready`.
2. SMS/voice-only **and** `requiresSmsVoice` → `telephony-exception-candidate`
   (deadline Feb or Jul by scope).
3. SMS/voice-only, or no methods at all (A3) → `feb-2027-blocked`, or
   `jul-2027-blocked` if Global Admin or `userType = external`.
   Internal guests are **Feb** scope, per Microsoft.
4. Otherwise (has a surviving non-passkey method) → `not-blocked-not-ready`.

Device blockers are added for non-ready users when a device export is
supplied: no rows → `no-device-data`; rows but none capable →
`no-capable-device` (+ `no-authenticator-on-device` if no device has
Authenticator installed).

## Assumptions

- **A1 — Token normalisation.** Method tokens are lowercased and stripped of
  punctuation/spaces before matching. Export formats vary; unknown tokens are
  treated as surviving non-passkey methods (fail toward "not blocked").
- **A2 — Device capability floors.** A device is "capable" if Authenticator
  is installed on it, or its OS major version is ≥ iOS 17 / Android 14 /
  macOS 14 / Windows 11. Heuristic for synced-passkey support — **not** a
  Microsoft support statement, and it ignores tenant attestation/AAGUID
  policy (roadmap).
- **A3 — No-methods users.** A user with zero registered methods is grouped
  with their earliest deadline cohort: under the registration campaign they
  must register at sign-in, so the practical wall is the same.
- **A4 — Telephony flag is an input, not an inference.** Real Entra exports
  have no `requiresSmsVoice` column. In production use this is joined from an
  HR list, an IdP group, or a manual frontline roster. passready never infers
  job need and never recommends buying the provider — it lists candidates
  for a human decision.
- **A5 — Non-telephony ≠ blocked.** Authenticator-push / TOTP-only users are
  not blocked by this retirement; they are a nudge list, not an emergency.

## Non-goals (v0.1)

- No Microsoft Graph / Okta / Google API calls of any kind.
- No remediation: passready never registers methods, messages users, or
  changes tenant state.
- No tenant policy evaluation (Conditional Access, authentication-methods
  policy, AAGUID allow-lists) — method data only.
- No database, server, or UI. The CLI *is* the product; a UI would reuse this
  rules engine unchanged.
- No real tenant data in the repo: `examples/` is synthetic, end to end.

## Fixture design

`examples/auth-methods.csv` has 15 synthetic users covering every cohort and
blocker, including the easy-to-miss cases: an internal guest (Feb, not Jul),
a Global Admin who is already passkey-ready (ready wins over admin scope),
a frontline telephony candidate, an external telephony candidate (Jul
deadline), a user with no methods, and a user with no device rows.
`examples/devices.csv` intentionally omits two users to exercise
`no-device-data`.
