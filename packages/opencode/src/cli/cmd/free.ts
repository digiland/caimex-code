import { Effect } from "effect"
import open from "open"
import { Auth } from "../../auth"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { apiBase } from "../../plugin/caimex"

// Kept in sync with PROVIDER_ID in src/plugin/caimex.ts.
const CAIMEX_PROVIDER_ID = "caimex"

/**
 * Free-tier standing for the logged-in gateway key.
 *
 * Shape of GET /v1/free-tier. Every field is optional on the wire: an older
 * gateway predates this endpoint entirely, and the command degrades to telling
 * the user where to look rather than printing zeroes as though they were real.
 */
interface FreeTierStatus {
  enabled?: boolean
  authenticated?: boolean
  tokens_granted?: number
  tokens_used?: number
  tokens_remaining?: number
  status?: string | null
  offer_tokens?: number
  offer_period?: "lifetime" | "daily" | "monthly"
  daily_token_limit?: number
  claim_url?: string
}

function fmt(n: number | undefined): string {
  return typeof n === "number" ? n.toLocaleString("en-US") : "—"
}

function renews(period: FreeTierStatus["offer_period"]): string {
  if (period === "daily") return "refills every day"
  if (period === "monthly") return "refills every month"
  return "one-off, never renewed"
}

/**
 * `caimex free` — show the free allowance, and hand off to the browser to claim it.
 *
 * Claiming deliberately happens on the web rather than in the terminal. It
 * sends an SMS and runs the anti-abuse gates (line type, virtual-number lookup,
 * per-network velocity), and opening those endpoints to a long-lived on-disk
 * API key would add a second SMS-spending surface for no real gain — the same
 * reasoning that keeps `/v1/free-tier` read-only. The browser handoff mirrors
 * how `caimex auth login` already works.
 */
export const FreeCommand = effectCmd({
  command: "free",
  describe: "show your free token allowance, or claim one",
  instance: false,
  // Declared as `open` with a default rather than as a literal "no-open"
  // option: yargs already derives `--no-open` from a boolean flag, and
  // declaring the negated spelling itself makes the command fail to parse.
  builder: (yargs) =>
    yargs.option("open", {
      describe: "open the claim URL in a browser",
      type: "boolean",
      default: true,
    }),
  handler: Effect.fn("Cli.free")(function* (args) {
    const auth = yield* Auth.Service
    const info = yield* Effect.orElseSucceed(auth.get(CAIMEX_PROVIDER_ID), () => undefined)
    const key =
      process.env.CAIMEX_API_KEY ??
      (info?.type === "api" ? info.key : info?.type === "oauth" ? info.access : undefined)

    const url = `${apiBase().replace(/\/+$/, "")}/free-tier`
    // Effect.promise, not tryPromise: every failure here — unreachable gateway,
    // a build that predates /v1/free-tier, malformed JSON — collapses to the
    // same "cannot answer" case, handled once below. Rejecting would put
    // `undefined` in the error channel, which is not a failure type.
    const status = yield* Effect.promise(async (): Promise<FreeTierStatus | undefined> => {
      try {
        const headers: Record<string, string> = { Accept: "application/json" }
        if (key) headers.Authorization = `Bearer ${key}`
        const res = await fetch(url, { headers })
        if (!res.ok) return undefined
        return (await res.json()) as FreeTierStatus
      } catch {
        return undefined
      }
    })

    if (!status) {
      yield* fail(`Could not read your allowance from ${url}. Is the gateway reachable and up to date?`)
      return
    }

    if (!status.enabled) {
      UI.println("The free tier is not currently offered on this gateway.")
      return
    }

    const claimUrl = status.claim_url
    const cap = status.daily_token_limit ?? 0

    // Holding a live allowance: report what is left, not what is on offer.
    if (status.status === "active" && (status.tokens_remaining ?? 0) > 0) {
      UI.println(
        UI.Style.TEXT_SUCCESS_BOLD +
          `${fmt(status.tokens_remaining)} free tokens left` +
          UI.Style.TEXT_NORMAL +
          ` of ${fmt(status.tokens_granted)}`,
      )
      if (status.offer_period && status.offer_period !== "lifetime") {
        UI.println(UI.Style.TEXT_DIM + `Your allowance ${renews(status.offer_period)}.` + UI.Style.TEXT_NORMAL)
      }
      if (cap > 0) {
        UI.println(UI.Style.TEXT_DIM + `Capped at ${fmt(cap)} tokens a day.` + UI.Style.TEXT_NORMAL)
      }
      UI.println("")
      UI.println(UI.Style.TEXT_DIM + "Run `caimex models` to see the models it covers." + UI.Style.TEXT_NORMAL)
      return
    }

    // Claimed and spent. Saying "verify a number" here would send the user in a
    // circle — a second number cannot top up an existing grant.
    if (status.status && status.status !== "active") {
      UI.println("Your free allowance is used up.")
      if (status.offer_period && status.offer_period !== "lifetime") {
        UI.println(UI.Style.TEXT_DIM + `It ${renews(status.offer_period)}.` + UI.Style.TEXT_NORMAL)
      } else {
        UI.println(UI.Style.TEXT_DIM + "Add credits to keep going." + UI.Style.TEXT_NORMAL)
      }
      return
    }

    // Nothing claimed yet.
    if (!status.authenticated) {
      UI.println("You are not logged in, so this is what the free tier offers rather than what you hold.")
      UI.println("")
    }
    UI.println(
      UI.Style.TEXT_SUCCESS_BOLD + `${fmt(status.offer_tokens)} free tokens` + UI.Style.TEXT_NORMAL +
        ` — ${renews(status.offer_period)}` + (cap > 0 ? `, capped at ${fmt(cap)} a day` : ""),
    )
    UI.println(UI.Style.TEXT_DIM + "Verify a mobile number to claim. No card needed." + UI.Style.TEXT_NORMAL)
    UI.println("")

    if (!claimUrl) {
      UI.println("Open your Caimex account in a browser and go to Credits → Free allowance.")
      return
    }

    UI.println(claimUrl)
    if (args.open === false) return

    // Best-effort, exactly like the device-login flow: a headless box has no
    // browser to open, and the URL above is the real instruction either way.
    yield* Effect.promise(async () => {
      try {
        await open(claimUrl)
      } catch {}
    })
  }),
})
