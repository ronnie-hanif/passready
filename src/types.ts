/**
 * Data model for passready. See SPEC.md for the full description.
 * Everything here is parsed from CSV exports — v0.1 never calls an API.
 */

/** How Entra classifies the account, as exported. */
export type UserType = "member" | "external" | "internalGuest" | "unknown";

/** One row of the Entra authentication-methods export. */
export interface UserAuthRecord {
  userPrincipalName: string;
  displayName: string;
  /** Manager display name (or UPN) exactly as exported; "" if absent. */
  manager: string;
  userType: UserType;
  isGlobalAdmin: boolean;
  /**
   * ASSUMPTION (see rules.ts): the export carries a flag for users whose job
   * genuinely requires SMS/voice — e.g. frontline / shared-device staff with
   * no personal-device option. Real Entra exports do not have this column;
   * in practice you'd join this from an HR/IdP group or a manual list.
   */
  requiresSmsVoice: boolean;
  /** Raw method tokens as exported, e.g. "sms", "passkey", "fido2SecurityKey". */
  methods: string[];
}

/** One row of an Intune / Jamf device export. A user may have 0..n rows. */
export interface DeviceRecord {
  userPrincipalName: string;
  deviceName: string;
  /** e.g. "iOS", "Android", "Windows", "macOS" */
  os: string;
  /** e.g. "17.4", "14", "11", "23H2" — compared loosely, see rules.ts. */
  osVersion: string;
  authenticatorInstalled: boolean;
}

export type Cohort =
  | "passkey-ready"
  | "feb-2027-blocked"
  | "jul-2027-blocked"
  | "telephony-exception-candidate"
  | "not-blocked-not-ready";

export type Blocker =
  | "no-passkey-or-fido2-method"
  | "sms-voice-only"
  | "no-mfa-methods-registered"
  | "no-device-data"
  | "no-capable-device"
  | "no-authenticator-on-device";

export interface UserResult {
  user: UserAuthRecord;
  cohort: Cohort;
  /** ISO date of the deadline that applies, or "" for ready / no-deadline. */
  deadline: string;
  blockers: Blocker[];
  /** True if at least one known device can register a passkey (rules.ts). */
  hasCapableDevice: boolean | null; // null = no device data supplied
  recommendedAction: string;
}
