import type { Effect, Scope } from "effect"
import type { Registration } from "./registration.js"

/** What a plugin tool's `execute` receives besides its input. */
export interface ToolContext {
  /** The session's folder; resolve relative paths against it, not the process cwd. */
  readonly directory: string
  readonly sessionID: string
  readonly agent: string
  readonly callID: string
}

/**
 * A tool the model can call. `parameters` is a JSON Schema object describing the input.
 * Every call goes through the permission system first, with the tool's name as the
 * action and `resources(input)` (default `["*"]`) as the resources, so an agent's rules
 * decide whether it runs, is asked about, or is refused.
 */
export interface ToolSpec {
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly resources?: (input: any) => ReadonlyArray<string>
  readonly execute: (input: any, context: ToolContext) => Effect.Effect<string, unknown>
}

export interface ToolDomain {
  /** Registers tools for the plugin's lifetime; names must match /^[A-Za-z][A-Za-z0-9_-]{0,63}$/. */
  readonly register: (tools: Readonly<Record<string, ToolSpec>>) => Effect.Effect<Registration, never, Scope.Scope>
}
