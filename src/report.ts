import { toCsv } from "./csv.js";
import { DATES, RULES_VERSION, summarise } from "./rules.js";
import type { Cohort, UserResult } from "./types.js";

export const COHORT_LABELS: Record<Cohort, string> = {
  "feb-2027-blocked": "Blocked 1 Feb 2027",
  "jul-2027-blocked": "Blocked 1 Jul 2027",
  "telephony-exception-candidate": "Telephony-exception candidate",
  "not-blocked-not-ready": "Not blocked, not passkey-ready",
  "passkey-ready": "Passkey-ready",
};

export function blockersCsv(results: UserResult[]): string {
  return toCsv(
    [
      "userPrincipalName",
      "displayName",
      "manager",
      "cohort",
      "deadline",
      "blockers",
      "methods",
      "hasCapableDevice",
      "recommendedAction",
    ],
    results.map((r) => [
      r.user.userPrincipalName,
      r.user.displayName,
      r.user.manager,
      r.cohort,
      r.deadline,
      r.blockers.join(";"),
      r.user.methods.join(";"),
      r.hasCapableDevice === null ? "unknown" : String(r.hasCapableDevice),
      r.recommendedAction,
    ]),
  );
}

export interface ManagerSummary {
  manager: string;
  total: number;
  passkeyReady: number;
  feb2027Blocked: number;
  jul2027Blocked: number;
  telephonyExceptionCandidates: number;
  notBlockedNotReady: number;
}

export function managerSummary(results: UserResult[]): ManagerSummary[] {
  const byManager = new Map<string, ManagerSummary>();
  for (const r of results) {
    const key = r.user.manager || "(no manager)";
    const s =
      byManager.get(key) ??
      ({
        manager: key,
        total: 0,
        passkeyReady: 0,
        feb2027Blocked: 0,
        jul2027Blocked: 0,
        telephonyExceptionCandidates: 0,
        notBlockedNotReady: 0,
      } as ManagerSummary);
    s.total++;
    if (r.cohort === "passkey-ready") s.passkeyReady++;
    else if (r.cohort === "feb-2027-blocked") s.feb2027Blocked++;
    else if (r.cohort === "jul-2027-blocked") s.jul2027Blocked++;
    else if (r.cohort === "telephony-exception-candidate")
      s.telephonyExceptionCandidates++;
    else if (r.cohort === "not-blocked-not-ready") s.notBlockedNotReady++;
    byManager.set(key, s);
  }
  return [...byManager.values()].sort((a, b) =>
    a.manager.localeCompare(b.manager),
  );
}

export function managerSummaryCsv(results: UserResult[]): string {
  return toCsv(
    [
      "manager",
      "total",
      "passkeyReady",
      "feb2027Blocked",
      "jul2027Blocked",
      "telephonyExceptionCandidates",
      "notBlockedNotReady",
    ],
    managerSummary(results).map((s) => [
      s.manager,
      String(s.total),
      String(s.passkeyReady),
      String(s.feb2027Blocked),
      String(s.jul2027Blocked),
      String(s.telephonyExceptionCandidates),
      String(s.notBlockedNotReady),
    ]),
  );
}

export function terminalSummary(results: UserResult[]): string {
  const c = summarise(results);
  const lines = [
    `passready — rules ${RULES_VERSION}`,
    `${results.length} users checked`,
    "",
    `  Blocked 1 Feb 2027:                 ${c["feb-2027-blocked"]}`,
    `  Blocked 1 Jul 2027:                 ${c["jul-2027-blocked"]}`,
    `  Telephony-exception candidates:     ${c["telephony-exception-candidate"]}`,
    `  Not blocked, not passkey-ready:     ${c["not-blocked-not-ready"]}`,
    `  Passkey-ready:                      ${c["passkey-ready"]}`,
  ];
  return lines.join("\n");
}

function userLine(r: UserResult): string {
  const blockers = r.blockers.length ? ` — blockers: ${r.blockers.join(", ")}` : "";
  return `- ${r.user.displayName} (${r.user.userPrincipalName})${blockers}`;
}

export function markdownReport(results: UserResult[]): string {
  const c = summarise(results);
  const byCohort = (cohort: Cohort) => results.filter((r) => r.cohort === cohort);
  const out: string[] = [
    "# passready report",
    "",
    `Rules version: ${RULES_VERSION}. Generated from CSV exports only — ` +
      "passready is read-only, calls no APIs, and stores no secrets.",
    "",
    "## Why these dates",
    "",
    `- **${DATES.passkeysAutoEnabled}** — Microsoft auto-enables passkeys for SMS/voice users in Entra.`,
    `- **${DATES.febDeadline}** — Microsoft-provided SMS/voice is retired for most users; SMS/voice-only users get a blocking passkey prompt. Global Admins and external users are excepted until July. Internal guests are in this scope.`,
    `- **${DATES.julDeadline}** — the same retirement lands for Global Admins and external users.`,
    `- The only way SMS/voice survives is a paid third-party telephony provider, configurable from **${DATES.telephonyProviderConfigurableFrom}**.`,
    "",
    "Source: Microsoft Learn, *SMS and voice retirement in Microsoft Entra*.",
    "",
    "## Summary",
    "",
    "| Cohort | Users |",
    "| --- | ---: |",
    `| Blocked 1 Feb 2027 | ${c["feb-2027-blocked"]} |`,
    `| Blocked 1 Jul 2027 | ${c["jul-2027-blocked"]} |`,
    `| Telephony-exception candidates | ${c["telephony-exception-candidate"]} |`,
    `| Not blocked, not passkey-ready | ${c["not-blocked-not-ready"]} |`,
    `| Passkey-ready | ${c["passkey-ready"]} |`,
    `| **Total** | **${results.length}** |`,
    "",
  ];
  (Object.keys(COHORT_LABELS) as Cohort[]).forEach((cohort) => {
    const users = byCohort(cohort);
    if (users.length === 0) return;
    out.push(`## ${COHORT_LABELS[cohort]} (${users.length})`, "");
    users.forEach((r) => out.push(userLine(r)));
    out.push("");
  });
  out.push(
    "## Assumptions",
    "",
    "See `src/rules.ts` (A1–A5). In short: method tokens are normalised before matching; " +
      "device capability uses OS floors (iOS 17 / Android 14 / macOS 14 / Windows 11) or an installed " +
      "Authenticator app as a heuristic, not a Microsoft support statement; users with no registered " +
      "methods are grouped with their earliest deadline cohort; telephony-exception candidates come " +
      "from an explicit `requiresSmsVoice` flag in the export, never inferred.",
    "",
  );
  return out.join("\n");
}
