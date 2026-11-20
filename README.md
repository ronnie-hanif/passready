# passready

**Who in your Entra tenant is about to get blocked?**

Microsoft is retiring Microsoft-provided SMS and voice MFA in Entra ID. Tenant-level
dashboards tell you a percentage. passready tells you *names*: a per-user list of who
will hit the blocking passkey prompt, why they're blocked, which deadline applies to
them, and who their manager is — built entirely from CSV exports you already have.

## Why this exists

Microsoft's published timeline
([SMS and voice retirement in Microsoft Entra](https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sms-voice-retirement)):

| Date | What happens |
| --- | --- |
| **1 Sep 2026** | Passkeys auto-enabled for SMS/voice users; Registration Campaign becomes Microsoft-managed |
| **30 Oct 2026** | Orgs can start configuring a paid third-party telephony provider (the *only* way SMS/voice survives) |
| **1 Feb 2027** | Microsoft-provided SMS/voice retired for most users. SMS/voice-only users get a **blocking** passkey prompt. No opt-out. Internal guests are in this scope |
| **1 Jul 2027** | Same retirement lands for Global Admins and external users |

Entra's own reports give you method counts. They don't join methods to device
capability, manager, admin/external scope, and frontline telephony needs — which is
exactly what decides who needs a nudge, who needs a security key, and who needs a
human decision about the paid telephony exception. That's the gap passready fills.

## Safety first

- **Read-only.** passready reads CSV files and writes reports. Nothing else.
- **Export-first.** v0.1 never calls Microsoft Graph or any other API.
- **No secrets.** No tokens, no credentials, nothing to leak — it works on exports.
- Ship it with synthetic data in demos; run it on real exports locally, on your machine.

## Install & run

Requires Node 18+.

```bash
npm install
npm run build
node dist/cli.js check \
  --auth-methods examples/auth-methods.csv \
  --devices examples/devices.csv \
  --out examples/output
```

Or against your own exports:

```bash
node dist/cli.js check --auth-methods ./my-entra-export.csv --out ./out
# --devices is optional; without it, device blockers are reported as unknown, never guessed
```

### Input format

`--auth-methods` — one row per user (see `examples/auth-methods.csv`):

| Column | Notes |
| --- | --- |
| `userPrincipalName`, `displayName`, `manager` | As exported |
| `userType` | `member` · `external` · `internalGuest` |
| `isGlobalAdmin` | `true`/`false` |
| `requiresSmsVoice` | `true` for frontline/shared-device staff whose job genuinely needs SMS/voice (see Assumptions in SPEC.md — Entra doesn't export this; join it from your own list) |
| `methods` | `;`-separated method tokens, e.g. `sms;voice`, `passkey`, `fido2SecurityKey`, `microsoftAuthenticatorPush` |

`--devices` (optional) — one row per device: `userPrincipalName, deviceName, os, osVersion, authenticatorInstalled` (Intune/Jamf export shape).

## Sample output

Against the synthetic 15-user fixture in `examples/`:

```
passready — rules 2026.1
15 users checked

  Blocked 1 Feb 2027:                 5
  Blocked 1 Jul 2027:                 2
  Telephony-exception candidates:     2
  Not blocked, not passkey-ready:     2
  Passkey-ready:                      4
```

Outputs written to `--out`:

- **`blockers.csv`** — one row per user: cohort, deadline, blockers, methods, recommended action. This is the helpdesk worklist.
- **`manager-summary.csv`** — per-manager counts per cohort. This is the "go nudge your team" list.
- **`report.md`** — a shareable Markdown report with the dates, summary, and per-cohort user lists.

## Cohorts

| Cohort | Meaning |
| --- | --- |
| `feb-2027-blocked` | SMS/voice-only (or no methods — see SPEC) and not in Jul scope |
| `jul-2027-blocked` | SMS/voice-only Global Admins and external users |
| `telephony-exception-candidate` | SMS/voice-only *and* flagged as genuinely needing it — a human decides on the paid provider |
| `not-blocked-not-ready` | Has a surviving method (Authenticator push, TOTP) but no phishing-resistant method |
| `passkey-ready` | Has a passkey / FIDO2 / Windows Hello / certificate method |

Blocker reasons include `no-passkey-or-fido2-method`, `sms-voice-only`,
`no-mfa-methods-registered`, `no-device-data`, `no-capable-device`, and
`no-authenticator-on-device`. The full rules, and every assumption behind them
(labelled A1–A5), live in [`src/rules.ts`](src/rules.ts) and [SPEC.md](SPEC.md).
Rules are versioned (`2026.1`) against the Microsoft dates above.

## Development

```bash
npm test          # Vitest — rules engine, one test per cohort + device blockers
npm run build     # tsc -> dist/
npm run check:example   # build + run against the synthetic fixture
```

## Roadmap

- **v0.2** — Optional Microsoft Graph import (read-only, delegated) alongside the CSV path; Okta authenticator + Google Workspace exports as additional inputs.
- **v0.3** — Tenant passkey policy awareness (AAGUID / attestation allow-lists) so "ready" reflects *your* policy, not just any passkey; helpdesk-load forecast per week until each deadline.
- **Later** — Generalise past the 2027 deadlines into ongoing phishing-resistant coverage reporting for new hires and movers.

## License

MIT — see [LICENSE](LICENSE).
