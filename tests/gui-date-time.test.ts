import { describe, expect, it } from "vitest"
import { formatCommitDate } from "../src/gui/format.js"

const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0")
}

/**
 * Expected text derived from the same `Date` using its local getters. Tests
 * build local instants and hand their ISO form to the formatter, so neither the
 * machine time zone nor its locale can change the expectation.
 */
function localStamp(date: Date): string {
  const day = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `${day} ${time}`
}

function localIso(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds = 0,
): string {
  return new Date(year, month - 1, day, hours, minutes, seconds, milliseconds).toISOString()
}

describe("formatCommitDate", () => {
  it("renders the full local date and time of a commit instant", () => {
    const value = formatCommitDate(localIso(2026, 11, 9, 12, 34, 56))
    expect(value).toBe("2026-11-09 12:34:56")
    expect(value).toMatch(STAMP)
  })

  it("keeps the seconds component", () => {
    const value = formatCommitDate(localIso(2026, 1, 2, 3, 4, 42))
    expect(value.endsWith(":42")).toBe(true)
    expect(value).toBe("2026-01-02 03:04:42")
  })

  it("zero-pads every component to a fixed width", () => {
    expect(formatCommitDate(localIso(2026, 1, 2, 3, 4, 5))).toBe("2026-01-02 03:04:05")
    expect(formatCommitDate(localIso(2026, 12, 31, 23, 59, 59))).toBe(
      "2026-12-31 23:59:59",
    )
  })

  it("keeps the local calendar day when the UTC instant crosses midnight", () => {
    const earlyMorning = localIso(2026, 6, 15, 0, 5, 0)
    const lateEvening = localIso(2026, 6, 15, 23, 55, 0)

    expect(formatCommitDate(earlyMorning)).toBe("2026-06-15 00:05:00")
    expect(formatCommitDate(lateEvening)).toBe("2026-06-15 23:55:00")
    expect(formatCommitDate(earlyMorning)).toBe(localStamp(new Date(earlyMorning)))
    expect(formatCommitDate(lateEvening)).toBe(localStamp(new Date(lateEvening)))
  })

  it("converts explicit offsets to local time instead of slicing the string", () => {
    for (const input of [
      "2026-11-09T12:34:56+08:00",
      "2026-11-09T20:30:00Z",
      "2026-11-09T23:59:58-05:00",
    ]) {
      const value = formatCommitDate(input)
      expect(value).toBe(localStamp(new Date(input)))
      expect(value).not.toContain("T")
      expect(value).not.toContain("+")
    }
  })

  it("ignores sub-second precision", () => {
    expect(formatCommitDate(localIso(2026, 11, 9, 12, 34, 56, 789))).toBe(
      "2026-11-09 12:34:56",
    )
  })

  it("renders date-only input as local midnight without shifting the day", () => {
    expect(formatCommitDate("2026-11-09")).toBe("2026-11-09 00:00:00")
    expect(formatCommitDate("2026-01-01")).toBe("2026-01-01 00:00:00")
  })

  it("returns an empty string for missing values", () => {
    expect(formatCommitDate("")).toBe("")
    expect(formatCommitDate("   ")).toBe("")
    expect(formatCommitDate(undefined as unknown as string)).toBe("")
    expect(formatCommitDate(null as unknown as string)).toBe("")
  })

  it("returns unparsable input unchanged", () => {
    expect(formatCommitDate("not a date")).toBe("not a date")
    expect(formatCommitDate("2026-13-45")).toBe("2026-13-45")
    expect(formatCommitDate("2026-02-31")).toBe("2026-02-31")
  })
})
