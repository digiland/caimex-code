import DOMPurify from "dompurify"
import { marked } from "marked"
import { createEffect, createMemo, onCleanup } from "solid-js"
import { highlight } from "../highlight"

// Model output is untrusted HTML once parsed. Sanitize it, and send links to the
// system browser (the main process turns target=_blank into shell.openExternal).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A") return
  node.setAttribute("target", "_blank")
  node.setAttribute("rel", "noopener noreferrer")
})

// Code blocks get a language label, a copy button and highlighting. Highlighting waits
// for the text to settle, so a streaming reply isn't re-coloured on every chunk; each
// new render replaces the DOM, and a stale result is dropped once its block is gone.
function enhance(root: HTMLElement) {
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const pre = code.parentElement as HTMLPreElement
    if (pre.parentElement?.classList.contains("codeblock")) continue
    const tag = [...code.classList].find((name) => name.startsWith("language-"))?.slice("language-".length)
    const text = code.textContent ?? ""

    const block = document.createElement("div")
    block.className = "codeblock"
    const bar = document.createElement("div")
    bar.className = "codeblock-bar"
    const label = document.createElement("span")
    label.textContent = tag ?? ""
    const copy = document.createElement("button")
    copy.textContent = "Copy"
    copy.onclick = () =>
      void navigator.clipboard.writeText(text).then(() => {
        copy.textContent = "Copied"
        setTimeout(() => (copy.textContent = "Copy"), 1500)
      })
    bar.append(label, copy)
    pre.replaceWith(block)
    block.append(bar, pre)

    void highlight(text, tag)
      .then((html) => {
        if (!html || !pre.isConnected) return
        const template = document.createElement("template")
        template.innerHTML = html
        const colored = template.content.firstElementChild
        if (colored) pre.replaceWith(colored)
      })
      .catch(() => {})
  }
}

export function Markdown(props: { text: string }) {
  let root!: HTMLDivElement
  let timer: ReturnType<typeof setTimeout> | undefined
  const html = createMemo(() => DOMPurify.sanitize(marked.parse(props.text, { gfm: true, async: false })))
  createEffect(() => {
    html()
    clearTimeout(timer)
    timer = setTimeout(() => enhance(root), 350)
  })
  onCleanup(() => clearTimeout(timer))
  return <div ref={root} class="md select-text" innerHTML={html()} />
}
