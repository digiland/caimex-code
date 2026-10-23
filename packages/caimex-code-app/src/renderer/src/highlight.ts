import type { HighlighterCore } from "shiki/core"

// Shiki loads lazily: the engine on the first code block, each language on first use.
// The JavaScript regex engine avoids shipping the oniguruma wasm.
const LANGUAGES: Record<string, () => Promise<unknown>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
}

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  console: "bash",
  py: "python",
  rs: "rust",
  yml: "yaml",
  md: "markdown",
  kt: "kotlin",
  rb: "ruby",
  "c++": "cpp",
  htm: "html",
}

let highlighter: Promise<HighlighterCore> | undefined

function get() {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
    ])
    return createHighlighterCore({
      themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighter
}

export function languageOf(tag: string | undefined) {
  if (!tag) return undefined
  const name = ALIASES[tag.toLowerCase()] ?? tag.toLowerCase()
  return name in LANGUAGES ? name : undefined
}

// Returns shiki's <pre> as HTML, with both palettes as CSS variables so the page's
// light/dark media query picks one; undefined for languages we don't carry.
export async function highlight(code: string, tag: string | undefined) {
  const lang = languageOf(tag)
  if (!lang) return undefined
  const core = await get()
  if (!core.getLoadedLanguages().includes(lang)) await core.loadLanguage(LANGUAGES[lang]() as never)
  return core.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  })
}
