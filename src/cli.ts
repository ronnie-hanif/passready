#!/usr/bin/env node
/**
 * passready CLI — v0.1
 *
 *   passready check --auth-methods <csv> [--devices <csv>] [--out <dir>]
 *
 * Read-only and export-first: it reads CSV files you exported, writes
 * reports, and never calls Microsoft Graph (or any API) and never stores
 * secrets.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { groupDevices, parseCsv, rowToDevice, rowToUser } from "./csv.js";
import {
  blockersCsv,
  markdownReport,
  managerSummaryCsv,
  terminalSummary,
} from "./report.js";
import { classifyAll } from "./rules.js";

const USAGE = `passready — who gets blocked when Entra retires SMS/voice MFA?

Usage:
  passready check --auth-methods <csv> [--devices <csv>] [--out <dir>]

Options:
  --auth-methods <csv>   Entra authentication-methods export (required)
  --devices <csv>        Optional Intune/Jamf device export
  --out <dir>            Output directory (default: ./passready-out)
  --help                 Show this help

Outputs: blockers.csv, manager-summary.csv, report.md
Read-only: no API calls, no secrets, works entirely on your exports.`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--")) {
      args[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return args;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(USAGE);
    return argv.length === 0 ? 1 : 0;
  }
  if (argv[0] !== "check") {
    console.error(`Unknown command: ${argv[0]}\n\n${USAGE}`);
    return 1;
  }
  const args = parseArgs(argv.slice(1));
  const authPath = args["auth-methods"];
  if (typeof authPath !== "string" || authPath === "") {
    console.error("Missing required --auth-methods <csv>\n\n" + USAGE);
    return 1;
  }
  const outDir = typeof args.out === "string" && args.out !== "" ? args.out : "passready-out";

  const users = parseCsv(readFileSync(authPath, "utf8")).map(rowToUser);
  if (users.length === 0) {
    console.error(`No users found in ${authPath}`);
    return 1;
  }

  let devicesByUpn;
  if (typeof args.devices === "string" && args.devices !== "") {
    const devices = parseCsv(readFileSync(args.devices, "utf8")).map(rowToDevice);
    devicesByUpn = groupDevices(devices);
  }

  const results = classifyAll(users, devicesByUpn);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "blockers.csv"), blockersCsv(results));
  writeFileSync(join(outDir, "manager-summary.csv"), managerSummaryCsv(results));
  writeFileSync(join(outDir, "report.md"), markdownReport(results));

  console.log(terminalSummary(results));
  console.log(`\nWrote blockers.csv, manager-summary.csv, report.md to ${outDir}/`);
  return 0;
}

process.exit(main());
