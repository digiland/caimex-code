---
name: incident-summary
description: Format for incident reports, alarm digests and log summaries. Load before summarising logs, alarms or an outage.
---

# Incident and log summaries

Save to `reports/YYYY-MM-DD-<system>-<short-name>.md`.

1. **Status line** — one sentence: what is affected, since when, current state (ongoing / mitigated / resolved).
2. **Impact** — who or what is affected, how many, which regions or sites.
3. **Timeline** — table of UTC and local (CAT, UTC+2) times with events, oldest first.
4. **Evidence** — the exact log lines or alarm IDs, quoted, with source file and line or query.
5. **Likely cause** — ranked hypotheses with the evidence for and against each. Say "unknown" rather than guess.
6. **Actions** — taken so far, and recommended next steps with owners if known.

Rules: never run commands that change a system (restarts, deletes, config changes) without asking first. Redact secrets, tokens and personal data from anything you quote.
