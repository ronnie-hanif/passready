import { describe, expect, it } from "vitest";
import { parseCsv, rowToUser } from "../src/csv.js";
import {
  classifyUser,
  hasPhishingResistantMethod,
  isCapableDevice,
  isSmsVoiceOnly,
  summarise,
  classifyAll,
} from "../src/rules.js";
import type { DeviceRecord, UserAuthRecord } from "../src/types.js";

function user(partial: Partial<UserAuthRecord>): UserAuthRecord {
  return {
    userPrincipalName: "test@example.com",
    displayName: "Test User",
    manager: "Maya Chen",
    userType: "member",
    isGlobalAdmin: false,
    requiresSmsVoice: false,
    methods: [],
    ...partial,
  };
}

function device(partial: Partial<DeviceRecord>): DeviceRecord {
  return {
    userPrincipalName: "test@example.com",
    deviceName: "Device",
    os: "iOS",
    osVersion: "18",
    authenticatorInstalled: false,
    ...partial,
  };
}

describe("method helpers", () => {
  it("recognises passkey / FIDO2 variants after normalisation", () => {
    expect(hasPhishingResistantMethod(user({ methods: ["Passkey (FIDO2)"] }))).toBe(true);
    expect(hasPhishingResistantMethod(user({ methods: ["fido2SecurityKey"] }))).toBe(true);
    expect(hasPhishingResistantMethod(user({ methods: ["windowsHelloForBusiness"] }))).toBe(true);
    expect(hasPhishingResistantMethod(user({ methods: ["sms"] }))).toBe(false);
  });

  it("detects SMS/voice-only users", () => {
    expect(isSmsVoiceOnly(user({ methods: ["sms", "voice"] }))).toBe(true);
    expect(isSmsVoiceOnly(user({ methods: ["sms", "microsoftAuthenticatorPush"] }))).toBe(false);
    expect(isSmsVoiceOnly(user({ methods: [] }))).toBe(false);
  });
});

describe("cohorts", () => {
  it("passkey-ready: user with a passkey, no blockers, no deadline", () => {
    const r = classifyUser(user({ methods: ["passkey"] }));
    expect(r.cohort).toBe("passkey-ready");
    expect(r.deadline).toBe("");
    expect(r.blockers).toEqual([]);
  });

  it("ready beats admin scope: a Global Admin with a passkey is ready, not Jul-blocked", () => {
    const r = classifyUser(user({ methods: ["passkey"], isGlobalAdmin: true }));
    expect(r.cohort).toBe("passkey-ready");
  });

  it("feb-2027-blocked: member with SMS only", () => {
    const r = classifyUser(user({ methods: ["sms"] }));
    expect(r.cohort).toBe("feb-2027-blocked");
    expect(r.deadline).toBe("2027-02-01");
    expect(r.blockers).toContain("sms-voice-only");
    expect(r.blockers).toContain("no-passkey-or-fido2-method");
  });

  it("feb-2027-blocked: internal guests are in Feb scope, not Jul", () => {
    const r = classifyUser(user({ methods: ["sms"], userType: "internalGuest" }));
    expect(r.cohort).toBe("feb-2027-blocked");
    expect(r.deadline).toBe("2027-02-01");
  });

  it("jul-2027-blocked: Global Admin with SMS only", () => {
    const r = classifyUser(user({ methods: ["sms"], isGlobalAdmin: true }));
    expect(r.cohort).toBe("jul-2027-blocked");
    expect(r.deadline).toBe("2027-07-01");
  });

  it("jul-2027-blocked: external user with voice only", () => {
    const r = classifyUser(user({ methods: ["voice"], userType: "external" }));
    expect(r.cohort).toBe("jul-2027-blocked");
    expect(r.deadline).toBe("2027-07-01");
  });

  it("telephony-exception-candidate: SMS/voice-only + requiresSmsVoice flag", () => {
    const r = classifyUser(user({ methods: ["sms", "voice"], requiresSmsVoice: true }));
    expect(r.cohort).toBe("telephony-exception-candidate");
    expect(r.deadline).toBe("2027-02-01");
  });

  it("telephony-exception keeps the Jul deadline for external users", () => {
    const r = classifyUser(
      user({ methods: ["sms"], requiresSmsVoice: true, userType: "external" }),
    );
    expect(r.cohort).toBe("telephony-exception-candidate");
    expect(r.deadline).toBe("2027-07-01");
  });

  it("requiresSmsVoice does NOT create a candidate when the user has a surviving method", () => {
    const r = classifyUser(
      user({ methods: ["sms", "microsoftAuthenticatorPush"], requiresSmsVoice: true }),
    );
    expect(r.cohort).toBe("not-blocked-not-ready");
  });

  it("not-blocked-not-ready: Authenticator push only (assumption A5)", () => {
    const r = classifyUser(user({ methods: ["microsoftAuthenticatorPush"] }));
    expect(r.cohort).toBe("not-blocked-not-ready");
    expect(r.deadline).toBe("");
    expect(r.blockers).toContain("no-passkey-or-fido2-method");
    expect(r.blockers).not.toContain("sms-voice-only");
  });

  it("no methods at all: grouped with the earliest deadline cohort (assumption A3)", () => {
    const r = classifyUser(user({ methods: [] }));
    expect(r.cohort).toBe("feb-2027-blocked");
    expect(r.blockers).toContain("no-mfa-methods-registered");
  });
});

describe("device blockers", () => {
  it("capable device: Authenticator installed, or OS at/above the floor", () => {
    expect(isCapableDevice(device({ os: "iOS", osVersion: "16", authenticatorInstalled: true }))).toBe(true);
    expect(isCapableDevice(device({ os: "Android", osVersion: "14" }))).toBe(true);
    expect(isCapableDevice(device({ os: "Android", osVersion: "12" }))).toBe(false);
    expect(isCapableDevice(device({ os: "Windows", osVersion: "10" }))).toBe(false);
    expect(isCapableDevice(device({ os: "Windows", osVersion: "11" }))).toBe(true);
  });

  it("no device rows in a supplied export -> no-device-data blocker", () => {
    const r = classifyUser(user({ methods: ["sms"] }), []);
    expect(r.blockers).toContain("no-device-data");
    expect(r.hasCapableDevice).toBe(false);
  });

  it("old device without Authenticator -> no-capable-device + no-authenticator-on-device", () => {
    const r = classifyUser(user({ methods: ["sms"] }), [
      device({ os: "Android", osVersion: "12", authenticatorInstalled: false }),
    ]);
    expect(r.blockers).toContain("no-capable-device");
    expect(r.blockers).toContain("no-authenticator-on-device");
  });

  it("capable device adds no device blockers (easy fix)", () => {
    const r = classifyUser(user({ methods: ["sms"] }), [
      device({ os: "iOS", osVersion: "18", authenticatorInstalled: true }),
    ]);
    expect(r.hasCapableDevice).toBe(true);
    expect(r.blockers).not.toContain("no-capable-device");
    expect(r.blockers).not.toContain("no-device-data");
  });

  it("no device export at all -> device state is unknown, never guessed", () => {
    const r = classifyUser(user({ methods: ["sms"] }), undefined);
    expect(r.hasCapableDevice).toBeNull();
    expect(r.blockers).not.toContain("no-device-data");
  });

  it("ready users get no device blockers even with an old device", () => {
    const r = classifyUser(user({ methods: ["fido2SecurityKey"] }), [
      device({ os: "Android", osVersion: "10" }),
    ]);
    expect(r.blockers).toEqual([]);
  });
});

describe("csv + summary plumbing", () => {
  it("parses a quoted auth-methods row into a user", () => {
    const rows = parseCsv(
      'userPrincipalName,displayName,manager,userType,isGlobalAdmin,requiresSmsVoice,methods\n' +
        '"a@example.com","User, A","Maya Chen",member,true,false,sms;voice\n',
    );
    const u = rowToUser(rows[0]);
    expect(u.displayName).toBe("User, A");
    expect(u.isGlobalAdmin).toBe(true);
    expect(u.methods).toEqual(["sms", "voice"]);
  });

  it("summarise counts every cohort", () => {
    const results = classifyAll([
      user({ userPrincipalName: "a@example.com", methods: ["passkey"] }),
      user({ userPrincipalName: "b@example.com", methods: ["sms"] }),
      user({ userPrincipalName: "c@example.com", methods: ["sms"], isGlobalAdmin: true }),
    ]);
    const counts = summarise(results);
    expect(counts["passkey-ready"]).toBe(1);
    expect(counts["feb-2027-blocked"]).toBe(1);
    expect(counts["jul-2027-blocked"]).toBe(1);
  });
});
