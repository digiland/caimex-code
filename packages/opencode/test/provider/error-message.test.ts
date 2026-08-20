import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderError } from "@/provider/error"
import { ProviderV2 } from "@opencode-ai/core/provider"

/**
 * The Caimex gateway is FastAPI, so every refusal it raises itself arrives as
 * `{"detail": "..."}`. That shape fails the AI SDK's openai-compatible error
 * schema (which wants `error.message`), so the SDK falls back to the bare
 * reason phrase and the only copy of the actionable sentence is the raw body.
 * These assert the user sees the sentence rather than a JSON dump.
 */
function apiError(init: { statusCode: number; message: string; responseBody: string }) {
  return new APICallError({
    message: init.message,
    url: "https://caimex.example/v1/chat/completions",
    requestBodyValues: {},
    statusCode: init.statusCode,
    responseBody: init.responseBody,
    isRetryable: false,
  })
}

function parse(error: APICallError) {
  return ProviderError.parseAPICallError({ providerID: ProviderV2.ID.make("caimex"), error })
}

describe("provider error messages", () => {
  test("surfaces a FastAPI detail instead of dumping the body", () => {
    const detail = "Verify your phone number to unlock your free allowance, or add credits."
    const parsed = parse(
      apiError({ statusCode: 402, message: "Payment Required", responseBody: JSON.stringify({ detail }) }),
    )
    expect(parsed.message).toBe(`Payment Required: ${detail}`)
    expect(parsed.message).not.toInclude("{")
  })

  test("surfaces a per-model free-tier 403", () => {
    const detail = "Model 'gpt-5-mini' is not available on the free tier. Add credits to use it."
    const parsed = parse(
      apiError({ statusCode: 403, message: "Forbidden", responseBody: JSON.stringify({ detail }) }),
    )
    expect(parsed.message).toBe(`Forbidden: ${detail}`)
  })

  test("surfaces the detail when there is no reason phrase (HTTP/2)", () => {
    // h2 has no reason phrase, so the SDK receives statusText === "".
    const detail = "Your free allowance is used up. Add credits to keep going."
    const parsed = parse(apiError({ statusCode: 402, message: "", responseBody: JSON.stringify({ detail }) }))
    expect(parsed.message).toBe(detail)
  })

  test("reads error.message out of the nested OpenAI shape", () => {
    // Regression: `body.error` was tested before `body.error.message`, so an
    // object-valued `error` matched, failed the string check, and fell through
    // to a raw dump even though the message was one level down.
    const parsed = parse(
      apiError({
        statusCode: 400,
        message: "Bad Request",
        responseBody: JSON.stringify({ error: { message: "unsupported parameter", type: "invalid_request_error" } }),
      }),
    )
    expect(parsed.message).toBe("Bad Request: unsupported parameter")
  })

  test("joins a FastAPI validation detail array", () => {
    const parsed = parse(
      apiError({
        statusCode: 422,
        message: "Unprocessable Entity",
        responseBody: JSON.stringify({ detail: [{ msg: "field required" }, { msg: "value is not a valid integer" }] }),
      }),
    )
    expect(parsed.message).toBe("Unprocessable Entity: field required; value is not a valid integer")
  })

  test("does not restate a status line the detail already carries", () => {
    const parsed = parse(
      apiError({ statusCode: 402, message: "Payment Required", responseBody: JSON.stringify({ detail: "Payment Required" }) }),
    )
    expect(parsed.message).toBe("Payment Required")
  })

  test("still dumps a body it cannot read a message out of", () => {
    const parsed = parse(apiError({ statusCode: 500, message: "Internal Server Error", responseBody: "{\"weird\":1}" }))
    expect(parsed.message).toBe('Internal Server Error: {"weird":1}')
  })
})
