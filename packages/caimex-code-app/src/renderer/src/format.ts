import type { Session } from "./api"

export function relativeTime(ms: number, now = Date.now()) {
  const seconds = Math.max(0, (now - ms) / 1000)
  if (seconds < 60) return "now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d`
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

export function fullTime(ms: number) {
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

export function projectName(directory: string) {
  return directory.split("/").filter(Boolean).at(-1) ?? directory
}

// Sessions nobody has titled yet are named after their creation timestamp.
export function sessionTitle(session: Session) {
  return session.title.startsWith("New session - ") ? "Untitled session" : session.title
}

export function compact(value: number) {
  if (value < 1000) return String(value)
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`
  return `${(value / 1_000_000).toFixed(1)}M`
}

export function modelName(id: string) {
  return id.split("/").at(-1) ?? id
}
