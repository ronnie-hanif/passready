# passready report

Rules version: 2026.1. Generated from CSV exports only — passready is read-only, calls no APIs, and stores no secrets.

## Why these dates

- **2026-09-01** — Microsoft auto-enables passkeys for SMS/voice users in Entra.
- **2027-02-01** — Microsoft-provided SMS/voice is retired for most users; SMS/voice-only users get a blocking passkey prompt. Global Admins and external users are excepted until July. Internal guests are in this scope.
- **2027-07-01** — the same retirement lands for Global Admins and external users.
- The only way SMS/voice survives is a paid third-party telephony provider, configurable from **2026-10-30**.

Source: Microsoft Learn, *SMS and voice retirement in Microsoft Entra*.

## Summary

| Cohort | Users |
| --- | ---: |
| Blocked 1 Feb 2027 | 5 |
| Blocked 1 Jul 2027 | 2 |
| Telephony-exception candidates | 2 |
| Not blocked, not passkey-ready | 2 |
| Passkey-ready | 4 |
| **Total** | **15** |

## Blocked 1 Feb 2027 (5)

- Bob Carter (bob.carter@example.com) — blockers: no-capable-device, no-authenticator-on-device, no-passkey-or-fido2-method, sms-voice-only
- Carol Diaz (carol.diaz@example.com) — blockers: no-device-data, no-passkey-or-fido2-method, sms-voice-only
- Grace Kim (grace.kim@example.com) — blockers: no-passkey-or-fido2-method, sms-voice-only
- Judy Flores (judy.flores@example.com) — blockers: no-capable-device, no-authenticator-on-device, no-passkey-or-fido2-method, no-mfa-methods-registered
- Karl Jensen (karl.jensen@example.com) — blockers: no-passkey-or-fido2-method, sms-voice-only

## Blocked 1 Jul 2027 (2)

- Erin Walsh (erin.walsh@example.com) — blockers: no-passkey-or-fido2-method, sms-voice-only
- Frank Meyer (frank.meyer@partner.example.com) — blockers: no-device-data, no-passkey-or-fido2-method, sms-voice-only

## Telephony-exception candidate (2)

- Dave Okafor (dave.okafor@example.com) — blockers: no-capable-device, no-authenticator-on-device, no-passkey-or-fido2-method, sms-voice-only
- Omar Haddad (omar.haddad@vendor.example.com) — blockers: no-passkey-or-fido2-method, sms-voice-only

## Not blocked, not passkey-ready (2)

- Ivan Petrov (ivan.petrov@example.com) — blockers: no-passkey-or-fido2-method
- Nadia Ali (nadia.ali@example.com) — blockers: no-passkey-or-fido2-method

## Passkey-ready (4)

- Alice Nguyen (alice.nguyen@example.com)
- Henry Ross (henry.ross@example.com)
- Lena Brooks (lena.brooks@example.com)
- Marcus Reid (marcus.reid@example.com)

## Assumptions

See `src/rules.ts` (A1–A5). In short: method tokens are normalised before matching; device capability uses OS floors (iOS 17 / Android 14 / macOS 14 / Windows 11) or an installed Authenticator app as a heuristic, not a Microsoft support statement; users with no registered methods are grouped with their earliest deadline cohort; telephony-exception candidates come from an explicit `requiresSmsVoice` flag in the export, never inferred.
