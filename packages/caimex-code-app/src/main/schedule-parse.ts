// Schedules in plain words, as Hermes' cron accepts them, so the two Scheduled lists read
// the same: "every day at 8am", "weekdays at 9am", "every monday, thursday 14:30",
// "every 2h", "in 30m", a 5-field cron expression, or an ISO date-time. All times are
// local (the Mac's time zone).

export type Parsed =
  | { kind: "cron"; minute: Set<number>; hour: Set<number>; day: Set<number>; month: Set<number>; weekday: Set<number>; dayAny: boolean; weekdayAny: boolean }
  | { kind: "interval"; minutes: number }
  | { kind: "once"; at: number }

const DAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
}
const DAY_SPECS: Record<string, number[]> = {
  day: [0, 1, 2, 3, 4, 5, 6], daily: [0, 1, 2, 3, 4, 5, 6], everyday: [0, 1, 2, 3, 4, 5, 6],
  weekday: [1, 2, 3, 4, 5], weekdays: [1, 2, 3, 4, 5], weekend: [0, 6], weekends: [0, 6],
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function clock(text: string): [number, number] | undefined {
  const t = text.replace(/\s+/g, "").toLowerCase()
  if (t === "noon" || t === "midday") return [12, 0]
  if (t === "midnight") return [0, 0]
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t)
  if (!match) return undefined
  let hour = Number(match[1])
  const minute = Number(match[2] ?? 0)
  if (match[3]) {
    if (hour < 1 || hour > 12) return undefined
    hour = (hour % 12) + (match[3] === "pm" ? 12 : 0)
  }
  return hour <= 23 && minute <= 59 ? [hour, minute] : undefined
}

function duration(text: string): number | undefined {
  const match = /^(\d+)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/.exec(text.trim().toLowerCase())
  if (!match) return undefined
  const n = Number(match[1])
  const unit = match[2][0]
  return unit === "m" ? n : unit === "h" ? n * 60 : n * 1440
}

function cronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>()
  for (const part of field.split(",")) {
    const [base, stepText] = part.split("/")
    const step = stepText ? Number(stepText) : 1
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in "${part}"`)
    let from = min
    let to = max
    if (base !== "*") {
      const [a, b] = base.split("-")
      from = Number(a)
      to = b === undefined ? (stepText ? max : from) : Number(b)
    }
    if (![from, to].every((n) => Number.isInteger(n) && n >= min && n <= max) || from > to)
      throw new Error(`"${part}" is out of range ${min}–${max}`)
    for (let n = from; n <= to; n += step) out.add(n)
  }
  return out
}

function naturalDays(tokens: string[]): { days: number[]; rest: string[] } | undefined {
  const first = DAY_SPECS[tokens[0]]
  if (first) return { days: first, rest: tokens.slice(1) }
  const days: number[] = []
  let index = 0
  for (; index < tokens.length; index++) {
    if (tokens[index] === "and") continue
    const day = DAYS[tokens[index]]
    if (day === undefined) break
    if (!days.includes(day)) days.push(day)
  }
  return days.length ? { days, rest: tokens.slice(index) } : undefined
}

export function parse(input: string, now = Date.now()): Parsed {
  const text = input.trim()
  const lower = text.toLowerCase()
  if (!text) throw new Error("Say when, e.g. “every day at 8am”.")

  // "every monday 9am", "weekdays at 9am", "every day at 08:00"
  const every = lower.startsWith("every ")
  const rest = (every ? lower.slice(6) : lower).replace(/,/g, " ").split(/\s+/).filter(Boolean)
  const days = naturalDays(rest)
  if (days) {
    const timeTokens = days.rest[0] === "at" ? days.rest.slice(1) : days.rest
    const time = clock(timeTokens.join(" "))
    if (!time) throw new Error(`Add a time, e.g. “${every ? "every" : ""} ${rest[0]} at 9am”.`.replace(/\s+/g, " "))
    return {
      kind: "cron",
      minute: new Set([time[1]]),
      hour: new Set([time[0]]),
      day: new Set(range(1, 31)),
      month: new Set(range(1, 12)),
      weekday: new Set(days.days),
      dayAny: true,
      weekdayAny: days.days.length === 7,
    }
  }
  if (every) {
    const minutes = duration(lower.slice(6))
    if (minutes) return { kind: "interval", minutes }
  }
  if (lower.startsWith("in ")) {
    const minutes = duration(lower.slice(3))
    if (minutes) return { kind: "once", at: now + minutes * 60_000 }
  }

  const fields = text.split(/\s+/)
  if (fields.length === 5 && fields.every((field) => /^[\d*,/-]+$/.test(field))) {
    return {
      kind: "cron",
      minute: cronField(fields[0], 0, 59),
      hour: cronField(fields[1], 0, 23),
      day: cronField(fields[2], 1, 31),
      month: cronField(fields[3], 1, 12),
      weekday: new Set([...cronField(fields[4].replace(/7/g, "0"), 0, 6)]),
      dayAny: fields[2] === "*",
      weekdayAny: fields[4] === "*",
    }
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const at = Date.parse(text.includes("T") || text.length === 10 ? text : text.replace(" ", "T"))
    if (Number.isFinite(at)) return { kind: "once", at }
  }
  const minutes = duration(lower)
  if (minutes) return { kind: "interval", minutes }

  throw new Error(
    "Couldn't read that schedule. Try “every day at 8am”, “weekdays at 9am”, “every monday 14:30”, “every 2h”, “in 30m”, or a cron expression like “0 8 * * 1-5”.",
  )
}

// The first run strictly after `after`; undefined once a one-off has passed.
export function next(parsed: Parsed, after: number, anchor = after): number | undefined {
  if (parsed.kind === "once") return parsed.at > after ? parsed.at : undefined
  if (parsed.kind === "interval") {
    const step = parsed.minutes * 60_000
    const elapsed = Math.max(0, after - anchor)
    return anchor + (Math.floor(elapsed / step) + 1) * step
  }
  const date = new Date(after)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() + 1)
  // A year of minutes at most; cron specs that never match return undefined.
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const dayMatch = parsed.day.has(date.getDate())
    const weekdayMatch = parsed.weekday.has(date.getDay())
    // Cron's rule: when both day fields are restricted, either may match.
    const dayOk =
      parsed.dayAny && parsed.weekdayAny
        ? true
        : parsed.dayAny
          ? weekdayMatch
          : parsed.weekdayAny
            ? dayMatch
            : dayMatch || weekdayMatch
    if (!parsed.month.has(date.getMonth() + 1) || !dayOk) {
      date.setHours(0, 0, 0, 0)
      date.setDate(date.getDate() + 1)
      continue
    }
    if (!parsed.hour.has(date.getHours())) {
      date.setMinutes(0)
      date.setHours(date.getHours() + 1)
      continue
    }
    if (parsed.minute.has(date.getMinutes())) return date.getTime()
    date.setMinutes(date.getMinutes() + 1)
  }
  return undefined
}

// A short description of when it runs, for lists.
export function describe(input: string): string {
  return input.trim().replace(/\s+/g, " ")
}
