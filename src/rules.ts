/**
 * passready rules engine — PURE functions, no I/O. Unit-tested in test/rules.test.ts.
 *
 * RULES_VERSION: "2026.1"
 * Versioned against Microsoft's published Entra SMS/voice retirement timeline
 * (https://learn.microsoft.com/en-us/entra/identity/authentication/concept-sms-voice-retirement):
 *
 *   2026-09-01  Passkeys auto-enabled for users enabled for SMS/voice;
 *               Registration Campaign switches to Microsoft-managed.
 *   2026-10-30  Orgs can configure a paid third-party telephony provider
 *               (initially Soprano / Telesign, via Microsoft Security Store)
 *               — this is the ONLY way SMS/voice survives the retirement.
 *   2027-02-01  Microsoft-provided SMS/voice retired for everyone EXCEPT
 *               Global Admins and external users. Internal guests ARE in
 *               this scope. SMS/voice-only users get a BLOCKING passkey
 *               registration prompt. No opt-out.
 *   2027-07-01  Same retirement lands for Global Admins and external users.
 *
 * If Microsoft slips these dates, bump RULES_VERSION, update the dates below,
 * and re-run the tests — cohorts are derived only from these constants.
 *
 * ---------------------------------------------------------------------------
 * ASSUMPTIONS (labelled, because a rules engine that hides them is worse
 * than one that states them):
 *
 * A1. Method tokens are matched case-insensitively against the sets below.
 *     Entra exports vary ("Microsoft Authenticator", "SMS", "#microsoft.graph.…");
 *     normaliseMethod() strips spaces/punctuation so common variants match.
 * A2. "Capable device" (hasCapableDevice): a device counts if Microsoft
 *     Authenticator is installed on it, OR its OS is at/above a floor where
 *     synced passkeys are broadly supported — iOS 17, Android 14, macOS 14,
 *     Windows 11. These floors are a heuristic, NOT a Microsoft support
 *     statement. Device-bound passkey / attestation policy in a real tenant
 *     can be stricter; v0.1 does not read tenant policy.
 * A3. A user with NO registered methods at all is grouped into the earliest
 *     deadline cohort that applies to them (Feb 2027, or Jul 2027 for
 *     Global Admins / external users): under the registration campaign they
 *     must register a passkey at sign-in, so they hit the same wall.
 * A4. "Telephony-exception candidate" requires the export's requiresSmsVoice
 *     flag (see types.ts). passready cannot infer job need from methods
 *     alone, and it never recommends the paid provider — it only surfaces
 *     the candidate list for a human to decide on before 2026-10-30.
 * A5. Users whose only methods are non-telephony, non-passkey (Authenticator
 *     push, TOTP) are NOT blocked by the SMS/voice retirement. They land in
 *     "not-blocked-not-ready": no deadline, but still no phishing-resistant
 *     method, so they belong on the nudge list, not the emergency list.
 * ---------------------------------------------------------------------------
 */

import type {
  Blocker,
  Cohort,
  DeviceRecord,
  UserAuthRecord,
  UserResult,
} from "./types.js";

export const RULES_VERSION = "2026.1";

export const DATES = {
  passkeysAutoEnabled: "2026-09-01",
  telephonyProviderConfigurableFrom: "2026-10-30",
  febDeadline: "2027-02-01",
  julDeadline: "2027-07-01",
} as const;

/** Methods that count as phishing-resistant / passkey-ready. */
const PHISHING_RESISTANT = new Set([
  "passkey",
  "passkeyfido2",
  "fido2securitykey",
  "fido2",
  "windowshelloforbusiness",
  "microsoftauthenticatorpasskey",
  "authenticatorpasskey",
  "certificatebasedauthentication",
  "x509certificate",
]);

/** Methods Microsoft retires (when Microsoft-provided) on the deadlines. */
const TELEPHONY = new Set(["sms", "voice", "phonecall", "voicecall", "textmessage"]);

/** Normalise an exported method token for set matching (assumption A1). */
export function normaliseMethod(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function hasPhishingResistantMethod(user: UserAuthRecord): boolean {
  return user.methods.some((m) => PHISHING_RESISTANT.has(normaliseMethod(m)));
}

export function hasTelephonyMethod(user: UserAuthRecord): boolean {
  return user.methods.some((m) => TELEPHONY.has(normaliseMethod(m)));
}

/** True when every registered method is SMS/voice (and at least one exists). */
export function isSmsVoiceOnly(user: UserAuthRecord): boolean {
  return (
    user.methods.length > 0 &&
    user.methods.every((m) => TELEPHONY.has(normaliseMethod(m)))
  );
}

/** OS-version floors for synced-passkey capability (assumption A2). */
const OS_FLOORS: Record<string, number> = {
  ios: 17,
  android: 14,
  macos: 14,
  windows: 11,
};

export function isCapableDevice(device: DeviceRecord): boolean {
  if (device.authenticatorInstalled) return true;
  const floor = OS_FLOORS[device.os.trim().toLowerCase()];
  if (floor === undefined) return false;
  const major = parseInt(device.osVersion, 10);
  return Number.isFinite(major) && major >= floor;
}

/**
 * Classify one user. `devices` is the user's device rows, or `undefined`
 * when no device export was supplied at all (device blockers then unknown,
 * never guessed).
 */
export function classifyUser(
  user: UserAuthRecord,
  devices?: DeviceRecord[],
): UserResult {
  const blockers: Blocker[] = [];
  const ready = hasPhishingResistantMethod(user);

  // --- device assessment -------------------------------------------------
  let hasCapableDevice: boolean | null = null;
  if (devices !== undefined) {
    hasCapableDevice = devices.some(isCapableDevice);
    if (!ready) {
      if (devices.length === 0) {
        blockers.push("no-device-data");
      } else if (!hasCapableDevice) {
        blockers.push("no-capable-device");
        if (!devices.some((d) => d.authenticatorInstalled)) {
          blockers.push("no-authenticator-on-device");
        }
      }
    }
  }

  // --- method blockers ---------------------------------------------------
  if (!ready) {
    blockers.push("no-passkey-or-fido2-method");
    if (user.methods.length === 0) blockers.push("no-mfa-methods-registered");
    else if (isSmsVoiceOnly(user)) blockers.push("sms-voice-only");
  }

  // --- cohort (precedence matters; first match wins) ---------------------
  // 1. Ready beats everything — even a Global Admin with a passkey is fine.
  if (ready) {
    return {
      user,
      cohort: "passkey-ready",
      deadline: "",
      blockers: [],
      hasCapableDevice,
      recommendedAction: "None — phishing-resistant method registered.",
    };
  }

  const julScope = user.isGlobalAdmin || user.userType === "external";
  // Internal guests are explicitly in Feb scope per Microsoft; only
  // Global Admins and *external* users get the Jul date.

  // 2. Telephony-exception candidates: SMS/voice-only + a genuine job need
  //    for it (A4). Surfaced early because the provider decision has its
  //    own date (configurable from 2026-10-30).
  if (user.requiresSmsVoice && isSmsVoiceOnly(user)) {
    return {
      user,
      cohort: "telephony-exception-candidate",
      deadline: julScope ? DATES.julDeadline : DATES.febDeadline,
      blockers,
      hasCapableDevice,
      recommendedAction:
        "Human decision: register a passkey, or include this user in the paid telephony-provider exception (configurable from 2026-10-30). Do not assume the exception.",
    };
  }

  // 3/4. Deadline cohorts: SMS/voice-only users, and (A3) users with no
  //      methods at all, hit the blocking prompt on their deadline.
  if (isSmsVoiceOnly(user) || user.methods.length === 0) {
    return julScope
      ? {
          user,
          cohort: "jul-2027-blocked",
          deadline: DATES.julDeadline,
          blockers,
          hasCapableDevice,
          recommendedAction:
            "Register a passkey or FIDO2 security key before 2027-07-01; after that date SMS/voice from Microsoft stops and the passkey prompt blocks sign-in.",
        }
      : {
          user,
          cohort: "feb-2027-blocked",
          deadline: DATES.febDeadline,
          blockers,
          hasCapableDevice,
          recommendedAction:
            "Register a passkey or FIDO2 security key before 2027-02-01; after that date SMS/voice from Microsoft stops and the passkey prompt blocks sign-in.",
        };
  }

  // 5. Has a surviving non-passkey method (Authenticator push, TOTP, …) —
  //    not blocked, not ready (A5).
  return {
    user,
    cohort: "not-blocked-not-ready",
    deadline: "",
    blockers,
    hasCapableDevice,
    recommendedAction:
      "Not blocked by the SMS/voice retirement, but has no phishing-resistant method — add to the passkey nudge list.",
  };
}

export function classifyAll(
  users: UserAuthRecord[],
  devicesByUpn?: Map<string, DeviceRecord[]>,
): UserResult[] {
  return users.map((u) =>
    classifyUser(
      u,
      devicesByUpn === undefined ? undefined : (devicesByUpn.get(u.userPrincipalName.toLowerCase()) ?? []),
    ),
  );
}

/** Cohort counts in a stable, human-meaningful order. */
export function summarise(results: UserResult[]): Record<Cohort, number> {
  const counts: Record<Cohort, number> = {
    "feb-2027-blocked": 0,
    "jul-2027-blocked": 0,
    "telephony-exception-candidate": 0,
    "not-blocked-not-ready": 0,
    "passkey-ready": 0,
  };
  for (const r of results) counts[r.cohort]++;
  return counts;
}
