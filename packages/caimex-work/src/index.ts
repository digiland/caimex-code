import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { registerTools } from "./tools"

// Work modes for Caimex Desktop: four agents (Research, Analyst, Writer, Ops), the
// slash commands that start common jobs with them, the skills they load for house
// formats, and tools for documents, APIs and notifications. Loaded like any plugin, from
// the `plugins` list in the global config (~/.config/caimex/opencode.jsonc).

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// Where each mode may write without asking. Paths are relative to the session's folder,
// and `*` spans subfolders. Anything else is asked about, never silently allowed.
const OUTPUTS = ["reports/*", "drafts/*", "analysis/*", "notes/*"]

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" }

// The last matching rule wins, so specific rules follow general ones.
function permissions(input: { bash: "ask" | "deny"; outputs: string[] }): Rule[] {
  return [
    { action: "*", resource: "*", effect: "ask" },
    { action: "read", resource: "*", effect: "allow" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
    { action: "grep", resource: "*", effect: "allow" },
    { action: "glob", resource: "*", effect: "allow" },
    { action: "webfetch", resource: "*", effect: "allow" },
    { action: "websearch", resource: "*", effect: "allow" },
    { action: "todowrite", resource: "*", effect: "allow" },
    { action: "question", resource: "*", effect: "allow" },
    { action: "skill", resource: "*", effect: "allow" },
    // This plugin's tools. http_request only writes to hosts the user allowed in
    // http-allow.json (see tools.ts): plugins can't raise permission prompts in 2.x.
    { action: "read_document", resource: "*", effect: "allow" },
    { action: "notify", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "ask" },
    ...input.outputs.map((resource): Rule => ({ action: "edit", resource, effect: "allow" })),
    { action: "external_directory", resource: "*", effect: "ask" },
    { action: "bash", resource: "*", effect: input.bash },
    { action: "plan_enter", resource: "*", effect: "deny" },
    { action: "plan_exit", resource: "*", effect: "deny" },
  ]
}

const SHARED = `
You work for a professional at Econet / Caimex in Zimbabwe (Central Africa Time, UTC+2). You are not a coding assistant here: your job is knowledge work, done carefully and delivered as files the user can open and share.

Working rules:
- Start by restating the task in one line. If the scope is genuinely unclear (which audience, which period, which market), ask one focused question with the question tool, then proceed.
- Plan multi-step work with todowrite and keep it current.
- Load the relevant skill before producing a deliverable (research-report, source-evaluation, data-analysis, business-writing, incident-summary, weekly-report).
- Save deliverables as Markdown in the folder: reports/ for reports and analyses, drafts/ for things someone will send, analysis/ for scripts and working files, notes/ for scratch notes. Create the folder if needed.
- Never invent facts, figures, quotes, sources or URLs. Say what you could not verify.
- Never send, publish, delete or change anything outside this folder. The user sends and publishes.
- Finish with a short summary: what you did, the file paths you wrote, and anything that needs the user's decision.
`.trim()

const AGENTS = [
  {
    id: "research",
    color: "#7FD6FF",
    description: "Research: searches the web, reads sources, cross-checks them, and writes cited reports and briefs.",
    bash: "deny" as const,
    system: `You are Research, a meticulous research analyst.

${SHARED}

How you research:
- Search broadly first (several phrasings, including local and regional sources), then read the most authoritative pages in full with webfetch. Snippets are leads, not evidence.
- Prefer primary sources. Cross-check anything that matters. Date every figure.
- Keep a running list of sources as you go so the citations are exact.
- Write for a decision-maker: lead with the answer, then the evidence.`,
  },
  {
    id: "analyst",
    color: "#14E0A1",
    description: "Analyst: works through spreadsheets, CSVs, exports and logs with scripts, and reports the findings.",
    bash: "ask" as const,
    system: `You are Analyst, a careful data analyst.

${SHARED}

How you analyse:
- Inspect the data before computing: columns, types, row counts, ranges, gaps, duplicates.
- Compute with saved scripts in analysis/ (python3, sqlite3, awk, or whatever is installed); never do arithmetic in your head for anything that matters.
- Never modify the original data files; work on copies.
- Reconcile totals, spot-check rows, and state every filter and assumption.
- Present results as tables with units and periods, then a plain-language interpretation.`,
  },
  {
    id: "writer",
    color: "#A855F7",
    description: "Writer: drafts emails, memos, proposals and summaries in house style, from notes, files or links.",
    bash: "deny" as const,
    system: `You are Writer, an experienced business writer and editor.

${SHARED}

How you write:
- Follow the business-writing skill: lead with the point, plain words, explicit asks, British English.
- Use the facts you are given; if something important is missing, leave a clear [placeholder] rather than inventing it.
- For summaries, keep the source's meaning; attribute opinions to their owners.
- Offer one draft, not several, unless asked. Save it to drafts/ and show it in your reply.`,
  },
  {
    id: "ops",
    color: "#FF9F0A",
    description: "Ops: reads logs, alarms and exports, finds what went wrong, and writes incident summaries and digests.",
    bash: "ask" as const,
    system: `You are Ops, a calm site-reliability and network-operations analyst.

${SHARED}

How you work:
- Read-only by default: inspect logs, alarm exports and command output. Ask before running anything that changes a system.
- Correlate by time (note time zones), by host/site and by error signature; count occurrences rather than eyeballing.
- Quote the exact evidence (log lines, alarm IDs) with where it came from.
- Rank likely causes with evidence for and against; say "unknown" when it is.
- Redact secrets, tokens and personal data from anything you quote.`,
  },
]

const COMMANDS = [
  {
    name: "research",
    agent: "research",
    description: "Research a topic and write a cited report",
    template: `Research this and write a cited report in reports/:\n\n$ARGUMENTS`,
  },
  {
    name: "brief",
    agent: "research",
    description: "One-page brief on a company, person, product or market",
    template: `Write a one-page brief (about 500 words) on: $ARGUMENTS\n\nCover what it is, key facts and figures with dates, recent developments (last 12 months), and what it means for us. Cite sources. Save to reports/.`,
  },
  {
    name: "compare",
    agent: "research",
    description: "Side-by-side comparison, e.g. /compare A vs B",
    template: `Compare: $ARGUMENTS\n\nProduce a comparison table on the criteria that matter for a decision, then a short recommendation with its trade-offs. Cite sources. Save to reports/.`,
  },
  {
    name: "analyse",
    agent: "analyst",
    description: "Analyse a data file and report the findings",
    template: `Analyse $ARGUMENTS\n\nFirst describe the data, then answer the obvious business questions it can answer (or the ones I name). Save scripts to analysis/ and the report to reports/.`,
  },
  {
    name: "summarise",
    agent: "writer",
    description: "Summarise a document, file or web page",
    template: `Summarise $ARGUMENTS\n\nGive a 5-bullet summary, then key details worth knowing, then any actions or decisions it implies. Save to reports/.`,
  },
  {
    name: "draft",
    agent: "writer",
    description: "Draft an email, memo or proposal",
    template: `Draft the following in house style and save it to drafts/:\n\n$ARGUMENTS`,
  },
  {
    name: "weekly-report",
    agent: "writer",
    description: "Compile a weekly status report from this folder",
    template: `Compile this week's status report from the files in this folder (reports/, drafts/, notes/ and anything dated in the last 7 days), using the weekly-report skill. $ARGUMENTS`,
  },
  {
    name: "incident",
    agent: "ops",
    description: "Investigate an incident from logs or a description",
    template: `Investigate this incident and write an incident summary to reports/:\n\n$ARGUMENTS`,
  },
  {
    name: "digest",
    agent: "ops",
    description: "Digest a log or alarm export: what happened, how often, what matters",
    template: `Digest $ARGUMENTS\n\nGroup events by signature, count them, show the timeline of the notable ones, and flag anything that needs action. Save to reports/.`,
  },
]

function expand(template: string, args: string) {
  const words = args.split(/\s+/).filter(Boolean)
  return template.replaceAll("$ARGUMENTS", args).replace(/\$(\d+)/g, (_, n: string) => words[Number(n) - 1] ?? "")
}

type SkillFile = { name: string; description?: string; path: string; content: string }

// Skills are Markdown with a small front matter block (name, description).
function readSkills(): SkillFile[] {
  const directory = join(root, "skills")
  return readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const path = join(directory, file)
      const text = readFileSync(path, "utf8")
      const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
      const meta = Object.fromEntries(
        (match?.[1] ?? "")
          .split("\n")
          .map((line) => /^(\w+):\s*(.*)$/.exec(line))
          .filter((found): found is RegExpExecArray => !!found)
          .map((found) => [found[1], found[2].trim()]),
      )
      return {
        name: meta.name || file.replace(/\.md$/, ""),
        description: meta.description,
        path,
        content: match ? text.slice(match[0].length) : text,
      }
    })
}

export default Plugin.define({
  id: "caimex-work",
  async setup(ctx) {
    await ctx.agent.transform((editor) => {
      for (const agent of AGENTS)
        editor.update(agent.id, (item) => {
          item.name = (agent.id[0].toUpperCase() + agent.id.slice(1)) as unknown as typeof item.name
          item.description = agent.description
          item.system = agent.system
          item.mode = "primary"
          item.color = agent.color as typeof item.color
          item.permissions = permissions({ bash: agent.bash, outputs: OUTPUTS })
        })
    })
    // A command switches the session to its mode, then sends the expanded prompt.
    await ctx.command.transform((editor) => {
      for (const command of COMMANDS)
        editor.add({
          name: command.name,
          description: command.description,
          execute: async (input) => {
            const session = await ctx.session.get({ sessionID: input.sessionID })
            if ((session as { agent?: string }).agent !== command.agent)
              await ctx.session.switchAgent({ sessionID: input.sessionID, agent: command.agent as never })
            await ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: expand(command.template, input.prompt.text ?? ""),
              delivery: input.delivery,
            } as never)
          },
        })
    })
    const skills = readSkills()
    await ctx.skill.transform((editor) => {
      for (const skill of skills)
        editor.add({ id: `caimex-work/${skill.name}`, ...skill } as never)
    })
    await registerTools(ctx)
  },
})
