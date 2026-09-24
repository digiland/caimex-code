import type { Registration } from "./registration.js"

export type { ToolContext } from "../effect/tool.js"
import type { ToolContext } from "../effect/tool.js"

/**
 * A tool the model can call. `parameters` is a JSON Schema object describing the input.
 * Every call goes through the permission system first, with the tool's name as the
 * action and `resources(input)` (default `["*"]`) as the resources. A thrown error is
 * reported to the model as the tool's failure.
 */
export interface ToolSpec {
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly resources?: (input: any) => ReadonlyArray<string>
  readonly execute: (input: any, context: ToolContext) => Promise<string> | string
}

export interface ToolDomain {
  readonly register: (tools: Readonly<Record<string, ToolSpec>>) => Promise<Registration>
}
