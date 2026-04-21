# Jobs MCP

MCP server for job-search workflows. Owns **discovery** (scraping, link
unwrapping, ATS detection) and **evaluation** (liveness, A-G rubric). Writes
results into SeriousLetter via its external API.

## Scope boundary

- **SeriousLetter (SL)** — platform of record. Companies, jobs, CVs, letters,
  PDF export, ORP submission. Remains the single source of truth.
- **Jobs MCP (this)** — everything workflow: scrape a URL, check if it's still
  live, unwrap tracker links, detect the ATS, run fit evaluation. Uses the SL
  external API (`X-API-Token`) to persist results.
- **SL-MCP** — thin API wrapper around SL. Eventually sheds scraping +
  `sl_jobroom_*` to Jobs MCP. Until then, both coexist; Jobs MCP shadows the
  migrated responsibilities.

## Tools (phase 1)

| Tool | Purpose |
|------|---------|
| `jm_scrape` | Scrape a job URL → structured data + liveness verdict. Dispatches to the right template. |
| `jm_liveness` | Pure classifier: active / expired / uncertain with reason. Runs on a URL or supplied HTML. |
| `jm_unwrap` | Follow Google / LinkedIn `/comm/` / Experteer tracker redirects to the real JD URL. |
| `jm_list_templates` | Available scraping templates. |

More tools (ORP bridge, A-G evaluate, ATS detect, letter draft) land in
later phases.

## Install

```bash
cd ~/dev/ai/jobs-mcp
bun install
bun run build
```

## Run locally

```bash
bun run dev
```

## Register with Claude Code

Add to `~/.claude.json` → `mcpServers`:

```json
"jobs": {
  "type": "stdio",
  "command": "node",
  "args": ["/absolute/path/to/jobs-mcp/dist/index.js"],
  "env": {
    "SL_API_URL": "https://your-seriousletter-host.example",
    "SL_API_TOKEN": "…",
    "ANTHROPIC_API_KEY": "…"
  }
}
```

- `SL_API_TOKEN` is only needed by tools that read from or persist to
  SeriousLetter (`jm_orp_sync_job`, `jm_evaluate`). Pure scrape /
  liveness / unwrap tools run without it.
- `ANTHROPIC_API_KEY` is only needed by `jm_evaluate`. Each invocation
  makes one Opus 4.7 call.
