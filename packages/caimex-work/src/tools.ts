import { execFile } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { extname, join, resolve } from "node:path"
import { promisify } from "node:util"
import type { ToolSpec } from "@opencode-ai/plugin/v2/promise"
import { extractText, getDocumentProxy } from "unpdf"

// Tools the work modes add to the daemon (through the Caimex fork's plugin tool hook).
// Every call passes the agent's permission rules first: the work modes allow reading
// documents and notifications, and ask before any API call.

const exec = promisify(execFile)
const MAX_OUTPUT = 60_000
const MAX_DOWNLOAD = 40 * 1024 * 1024
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

const truncate = (text: string, limit = MAX_OUTPUT) =>
  text.length > limit ? `${text.slice(0, limit)}\n\n[… truncated: ${text.length - limit} more characters. Ask for a page range to read further.]` : text

const str = (value: unknown) => (typeof value === "string" ? value : undefined)
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

// ---------------------------------------------------------------------------
// read_document: the text of a PDF, Word or PowerPoint file, or a web page, from a URL
// or a local path. Covers what the built-in webfetch refuses (PDFs, Office files).

type Loaded = { bytes: Uint8Array; type: string; name: string }

async function load(source: string, cwd: string): Promise<Loaded> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, {
      headers: { "User-Agent": BROWSER_UA, Accept: "*/*", "Accept-Language": "en-GB,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? `HTTP ${response.status}: the site refused automated access. Try another copy of the document.`
          : `HTTP ${response.status} fetching ${source}`,
      )
    const declared = Number(response.headers.get("content-length") ?? 0)
    if (declared > MAX_DOWNLOAD) throw new Error(`The document is too large (${Math.round(declared / 1e6)} MB).`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_DOWNLOAD) throw new Error("The document is too large.")
    return { bytes, type: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(), name: new URL(response.url).pathname }
  }
  const path = resolve(cwd, source.replace(/^~(?=\/|$)/, homedir()))
  if (!existsSync(path)) throw new Error(`No such file: ${path}`)
  if (statSync(path).size > MAX_DOWNLOAD) throw new Error("The document is too large.")
  return { bytes: new Uint8Array(readFileSync(path)), type: "", name: path }
}

const kindOf = (loaded: Loaded) => {
  const extension = extname(loaded.name).toLowerCase()
  const head = new TextDecoder().decode(loaded.bytes.slice(0, 5))
  if (loaded.type === "application/pdf" || extension === ".pdf" || head === "%PDF-") return "pdf"
  if (extension === ".docx" || loaded.type.includes("wordprocessingml")) return "docx"
  if (extension === ".pptx" || loaded.type.includes("presentationml")) return "pptx"
  if (loaded.type.includes("html") || extension === ".html" || extension === ".htm") return "html"
  return "text"
}

async function pdfText(bytes: Uint8Array, pages?: { from?: number; to?: number }) {
  const pdf = await getDocumentProxy(bytes)
  const { totalPages, text } = await extractText(pdf, { mergePages: false })
  const from = Math.max(1, pages?.from ?? 1)
  const to = Math.min(totalPages, pages?.to ?? totalPages)
  const body = (text as string[])
    .slice(from - 1, to)
    .map((page, index) => `--- page ${from + index} ---\n${page.trim()}`)
    .join("\n\n")
  return `PDF, ${totalPages} page${totalPages === 1 ? "" : "s"}${from > 1 || to < totalPages ? `, showing ${from}–${to}` : ""}.\n\n${body}`
}

// Office files are zips of XML; `unzip` ships with macOS and most Linux systems.
async function officeText(bytes: Uint8Array, kind: "docx" | "pptx") {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const dir = mkdtempSync(join(tmpdir(), "caimex-doc-"))
  try {
    const file = join(dir, `document.${kind}`)
    writeFileSync(file, bytes)
    const pattern = kind === "docx" ? "word/document.xml" : "ppt/slides/slide*.xml"
    const { stdout } = await exec("unzip", ["-p", file, pattern], { maxBuffer: 64 * 1024 * 1024 })
    return stdout
      .replace(/<\/w:p>|<\/a:p>/g, "\n")
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function htmlText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
}

const readDocument: ToolSpec = {
  description: `Read the text of a document from a URL or a local file path: PDF, Word (.docx), PowerPoint (.pptx), HTML pages and plain text. Use it for PDFs and Office files (the webfetch tool can't read them), and when webfetch fails on a page. For long PDFs, pass pages to read a range. Relative paths are resolved against the session's folder.`,
  parameters: {
    type: "object",
    properties: {
      source: { type: "string", description: "An http(s) URL, or a file path (absolute, ~/…, or relative to the session folder)" },
      from_page: { type: "number", description: "PDF only: first page to read (1-based)" },
      to_page: { type: "number", description: "PDF only: last page to read" },
    },
    required: ["source"],
    additionalProperties: false,
  },
  resources: (input) => [str(input?.source) ?? "*"],
  execute: async (input, context) => {
    const source = str(input?.source)
    if (!source) throw new Error("source is required")
    const cwd = context.directory
    const loaded = await load(source, cwd)
    const kind = kindOf(loaded)
    if (kind === "pdf")
      return truncate(await pdfText(loaded.bytes, { from: num(input?.from_page), to: num(input?.to_page) }))
    if (kind === "docx" || kind === "pptx") return truncate(await officeText(loaded.bytes, kind))
    const text = new TextDecoder().decode(loaded.bytes)
    return truncate(kind === "html" ? htmlText(text) : text)
  },
}

// ---------------------------------------------------------------------------
// http_request: call any HTTP API. Secrets are written as {{secret:NAME}} and filled in
// here, from ~/.config/caimex-code/secrets.json or CAIMEX_SECRET_NAME in the daemon's
// environment, so keys never pass through the conversation.

const secretsFile = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "caimex-code", "secrets.json")

function secret(name: string) {
  const fromEnv = process.env[`CAIMEX_SECRET_${name}`]
  if (fromEnv) return fromEnv
  try {
    const value = (JSON.parse(readFileSync(secretsFile(), "utf8")) as Record<string, unknown>)[name]
    if (typeof value === "string") return value
  } catch {
    // no secrets file
  }
  throw new Error(`No secret named ${name}. Add it to ${secretsFile()} or set CAIMEX_SECRET_${name}.`)
}

const fill = (text: string) => text.replace(/\{\{secret:([A-Za-z0-9_]+)\}\}/g, (_, name: string) => secret(name))
// Anything filled in is masked again in what the model sees.
const mask = (text: string, secrets: string[]) => secrets.reduce((out, value) => (value ? out.split(value).join("••••") : out), text)

const httpRequest: ToolSpec = {
  description: `Call an HTTP API (REST/JSON). Use for services that have an API: ticketing, wikis, CRMs, internal services. Put credentials as {{secret:NAME}} placeholders in headers, query or body; they are filled in from the user's secrets and never shown. Each call is approved by the user unless they chose to always allow that host. Prefer GET; only send writes (POST/PUT/PATCH/DELETE) when the task clearly asks for it.`,
  parameters: {
    type: "object",
    properties: {
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
      url: { type: "string", description: "Full https URL" },
      query: { type: "object", additionalProperties: { type: "string" }, description: "Query parameters" },
      headers: { type: "object", additionalProperties: { type: "string" } },
      json: { description: "A JSON body (sets Content-Type: application/json)" },
      body: { type: "string", description: "A raw body, when not JSON" },
    },
    required: ["method", "url"],
    additionalProperties: false,
  },
  // Approval, and "always allow", are per host and method.
  resources: (input) => {
    try {
      return [`${str(input?.method) ?? "GET"} ${new URL(str(input?.url) ?? "").host}`]
    } catch {
      return ["*"]
    }
  },
  execute: async (input) => {
    const method = (str(input?.method) ?? "GET").toUpperCase()
    const used: string[] = []
    const track = (text: string) => {
      const filled = fill(text)
      if (filled !== text) for (const match of text.matchAll(/\{\{secret:([A-Za-z0-9_]+)\}\}/g)) used.push(secret(match[1]))
      return filled
    }
    const url = new URL(track(str(input?.url) ?? ""))
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed.")
    for (const [key, value] of Object.entries((input?.query ?? {}) as Record<string, unknown>))
      url.searchParams.set(key, track(String(value)))
    const headers: Record<string, string> = {}
    for (const [key, value] of Object.entries((input?.headers ?? {}) as Record<string, unknown>)) headers[key] = track(String(value))
    let body: string | undefined
    if (input?.json !== undefined) {
      body = track(JSON.stringify(input.json))
      headers["Content-Type"] ??= "application/json"
    } else if (typeof input?.body === "string") body = track(input.body)
    const response = await fetch(url, { method, headers, body, redirect: "follow", signal: AbortSignal.timeout(60_000) })
    const type = response.headers.get("content-type") ?? ""
    let text = method === "HEAD" ? "" : await response.text()
    if (type.includes("json")) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        // leave as sent
      }
    } else if (type.includes("html")) text = htmlText(text)
    const shownHeaders = ["content-type", "location", "x-ratelimit-remaining", "retry-after"]
      .map((name) => [name, response.headers.get(name)] as const)
      .filter(([, value]) => value)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\n")
    return mask(truncate(`HTTP ${response.status} ${response.statusText}\n${shownHeaders}\n\n${text}`, 40_000), used)
  },
}

// ---------------------------------------------------------------------------
// notify: a macOS notification, so a long or scheduled task can say it's done.

const notify: ToolSpec = {
  description:
    "Show a desktop notification to the user. Use it once when a long-running or scheduled task finishes or needs the user's attention; keep the message under 120 characters.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      message: { type: "string" },
    },
    required: ["message"],
    additionalProperties: false,
  },
  execute: async (input) => {
    const message = (str(input?.message) ?? "").slice(0, 240)
    const title = (str(input?.title) ?? "Caimex").slice(0, 80)
    if (process.platform !== "darwin") return "Notifications are only supported on macOS; nothing was shown."
    const quote = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
    await exec("osascript", ["-e", `display notification ${quote(message)} with title ${quote(title)}`])
    return "Notification shown."
  },
}

export const TOOLS: Record<string, ToolSpec> = {
  read_document: readDocument,
  http_request: httpRequest,
  notify,
}

