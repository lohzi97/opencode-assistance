import { describe, expect, test } from "bun:test";
import {
  CliError,
  formatDateMs,
  formatNumber,
  hitRate,
  parseArgs,
  parseDateArg,
  toUsageRow,
  validateDateArg,
} from "./usage-report";

describe("usage-report arg parsing", () => {
  test("applies defaults", () => {
    const args = parseArgs([]);
    expect(args.group).toBe("by-provider");
    expect(args.format).toBe("table");
    expect(args.sort).toBe("tokens");
    expect(args.help).toBe(false);
    expect(args.db).toContain("opencode.db");
  });

  test("parses value and boolean flags", () => {
    const args = parseArgs([
      "--project",
      "/tmp/p",
      "--days",
      "3",
      "--group",
      "by-model",
      "--json",
      "--sort",
      "cost",
    ]);
    expect(args.project).toBe("/tmp/p");
    expect(args.days).toBe(3);
    expect(args.group).toBe("by-model");
    expect(args.format).toBe("json");
    expect(args.sort).toBe("cost");
  });

  test("rejects unknown arguments", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(CliError);
  });

  test("rejects invalid group, format, and sort", () => {
    expect(() => parseArgs(["--group", "nope"])).toThrow(CliError);
    expect(() => parseArgs(["--format", "nope"])).toThrow(CliError);
    expect(() => parseArgs(["--sort", "nope"])).toThrow(CliError);
  });

  test("rejects days below 1 and invalid dates", () => {
    expect(() => parseArgs(["--days", "0"])).toThrow(/--days/);
    expect(() => parseArgs(["--days", "-1"])).toThrow(/--days/);
    expect(() => parseArgs(["--from", "2026-13-45"])).toThrow(CliError);
    expect(() => parseArgs(["--to", "not-a-date"])).toThrow(CliError);
    expect(() => parseArgs(["--timezone", "Mars/Olympus"])).toThrow(CliError);
  });
});

describe("usage-report date helpers", () => {
  test("parseDateArg returns local midnight", () => {
    const d = parseDateArg("2026-08-25");
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(25);
    expect(d.getHours()).toBe(0);
  });

  test("validateDateArg rejects impossible dates", () => {
    expect(() => validateDateArg("2026-02-30")).toThrow(CliError);
    expect(() => validateDateArg("2026-8-1")).toThrow(CliError);
    expect(() => validateDateArg("abc")).toThrow(CliError);
  });

  test("formatDateMs renders YYYY-MM-DD", () => {
    expect(formatDateMs(new Date(2026, 7, 25, 18, 30).getTime())).toBe("2026-08-25");
  });
});

describe("usage-report aggregation helpers", () => {
  test("hitRate divides hit over hit+miss", () => {
    expect(hitRate(3_163_392, 518_787)).toBeCloseTo(0.8591, 3);
  });

  test("hitRate returns null when denominator is zero", () => {
    expect(hitRate(0, 0)).toBeNull();
    expect(hitRate(10, 0)).toBe(1);
  });

  test("formatNumber uses thousands separators", () => {
    expect(formatNumber(3_163_392)).toBe("3,163,392");
    expect(formatNumber(0)).toBe("0");
  });

  test("toUsageRow clamps negative values and computes total", () => {
    const row = toUsageRow("by-provider", {
      provider_id: "openrouter",
      msgs: 41,
      cache_hit: 3163392,
      cache_miss: 518787,
      output: 9619,
      reasoning: 11287,
      cache_write: -5,
      cost: 0.167,
    });
    expect(row.total).toBe(3703085);
    expect(row.cacheWrite).toBe(0);
    expect(row.hitRate).toBeCloseTo(0.859, 3);
  });
});