// Loose semver comparison shared by the update prompt and the sidebar's
// "update available" indicator — both have to agree on whether the version the
// server announced is actually newer than the one this build reports.
export function isVersionGreater(left: string, right: string) {
  const parse = (value: string) => {
    const [core, prerelease] = value.replace(/^v/, "").split("-", 2)
    return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference) return difference > 0
  }
  if (a.prerelease === b.prerelease) return false
  if (!a.prerelease) return true
  if (!b.prerelease) return false
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
}

// KV keys the update state lives under. app.tsx writes them from the
// installation events; the sidebar footer reads them.
export const UPDATE_AVAILABLE_KEY = "update_available_version"
export const UPDATE_INSTALLED_KEY = "update_installed_version"
