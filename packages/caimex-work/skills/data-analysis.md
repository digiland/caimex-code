---
name: data-analysis
description: Workflow for analysing spreadsheets, CSVs, logs or exports. Load before analysing any data file.
---

# Analysing data

1. **Look before you compute.** Read the first rows, list the columns, types, row count, date range and obvious gaps or duplicates. Write these down.
2. **Confirm the question.** If the goal is ambiguous (which metric, which period, which segment), ask with the question tool before doing the work.
3. **Keep the original untouched.** Work on copies; put scripts in `analysis/` and outputs in `reports/`.
4. **Use scripts, not mental arithmetic.** Prefer whatever is installed (`python3`, `awk`, `sqlite3`, `csvkit`). Save each script so the result can be rerun.
5. **Check the result.** Totals should reconcile with the source; spot-check a few rows by hand; watch for currency, unit and time-zone mix-ups.
6. **Report.** Lead with the answer, then a table of the key figures, then method and caveats (filters, excluded rows, assumptions).

Name outputs `reports/YYYY-MM-DD-<topic>.md` and any tables `reports/<topic>.csv`.
