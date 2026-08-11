import { describe, expect, test } from "bun:test"
import type { IntegrationInfo } from "@opencode-ai/sdk/v2"
import { integrationOptions } from "../../../../src/component/dialog-integration"

const integration = (id: string, name: string, methods: IntegrationInfo["methods"]): IntegrationInfo => ({
  id,
  name,
  methods,
  connections: [],
})

const oauth = { id: "device", type: "oauth", label: "Login" } as const
const key = { type: "key", label: "API key" } as const
const env: IntegrationInfo["methods"][number] = { type: "env", names: ["SOME_TOKEN"] }

describe("integrationOptions", () => {
  test("keeps integrations offering a method the dialog can drive", () => {
    expect(
      integrationOptions([
        integration("caimex", "Caimex Gateway", [oauth, key]),
        integration("anthropic", "Anthropic", [key]),
      ]).map((item) => item.id),
    ).toEqual(["anthropic", "caimex"])
  })

  test("drops integrations that can only be configured outside the app", () => {
    // env-only means "set a variable in your shell" — selecting it in a dialog
    // would look like a no-op, so it never reaches the list.
    expect(integrationOptions([integration("bedrock", "Amazon Bedrock", [env])])).toEqual([])
  })

  test("keeps an integration that offers env alongside a usable method", () => {
    expect(integrationOptions([integration("openai", "OpenAI", [env, key])]).map((item) => item.id)).toEqual(["openai"])
  })

  test("sorts by name, then id, so the list is stable across refreshes", () => {
    expect(
      integrationOptions([
        integration("zeta", "Zeta", [key]),
        integration("beta-2", "Beta", [key]),
        integration("beta-1", "Beta", [key]),
        integration("alpha", "Alpha", [key]),
      ]).map((item) => item.id),
    ).toEqual(["alpha", "beta-1", "beta-2", "zeta"])
  })

  test("does not mutate the list it is given", () => {
    const list = [integration("zeta", "Zeta", [key]), integration("alpha", "Alpha", [key])]
    integrationOptions(list)
    expect(list.map((item) => item.id)).toEqual(["zeta", "alpha"])
  })
})
