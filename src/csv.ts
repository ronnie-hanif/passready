/**
 * Minimal CSV parse/write + export-row mapping.
 * Hand-rolled on purpose: quoted fields, embedded commas and "" escapes are
 * handled; nothing fancier is needed for IdP/MDM exports, and v0.1 keeps
 * zero runtime dependencies.
 */

import type { DeviceRecord, UserAuthRecord, UserType } from "./types.js";

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const headers = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = (r[idx] ?? "").trim();
    });
    return obj;
  });
}

function escapeCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(r.map(escapeCell).join(","));
  return lines.join("\n") + "\n";
}

function truthy(v: string | undefined): boolean {
  return /^(true|yes|y|1)$/i.test((v ?? "").trim());
}

function parseUserType(v: string | undefined): UserType {
  const t = (v ?? "").trim().toLowerCase();
  if (t === "member") return "member";
  if (t === "external" || t === "guest") return "external";
  if (t === "internalguest" || t === "internal guest" || t === "internal_guest")
    return "internalGuest";
  return "unknown";
}

/** Map one auth-methods export row to a UserAuthRecord. */
export function rowToUser(row: Record<string, string>): UserAuthRecord {
  const methods = (row["methods"] ?? "")
    .split(/[;|]/)
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    userPrincipalName: row["userPrincipalName"] ?? "",
    displayName: row["displayName"] ?? "",
    manager: row["manager"] ?? "",
    userType: parseUserType(row["userType"]),
    isGlobalAdmin: truthy(row["isGlobalAdmin"]),
    requiresSmsVoice: truthy(row["requiresSmsVoice"]),
    methods,
  };
}

export function rowToDevice(row: Record<string, string>): DeviceRecord {
  return {
    userPrincipalName: row["userPrincipalName"] ?? "",
    deviceName: row["deviceName"] ?? "",
    os: row["os"] ?? "",
    osVersion: row["osVersion"] ?? "",
    authenticatorInstalled: truthy(row["authenticatorInstalled"]),
  };
}

export function groupDevices(
  devices: DeviceRecord[],
): Map<string, DeviceRecord[]> {
  const map = new Map<string, DeviceRecord[]>();
  for (const d of devices) {
    const key = d.userPrincipalName.toLowerCase();
    const list = map.get(key) ?? [];
    list.push(d);
    map.set(key, list);
  }
  return map;
}
