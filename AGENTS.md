# AGENTS.md

## Agent skills

### Issue tracker

Issues live in the repo itself — GitHub issues on pedrosousa13/playdeck, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label names, as repo labels on pedrosousa13/playdeck — plus `in-progress` and `P0`–`P3`, labels that stand in for a missing field. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Comments

Durable rationale belongs in source; investigation narrative belongs on the issue. A comment naming an open issue number is a claim with an expiry date. See `docs/agents/comments.md`.

### Demonstrated red

A new assertion does not count until it has been shown failing against the unfixed code, with the real output recorded in the PR body, the commit message, or a comment beside the test. Where the code cannot be un-written, name the substitute mutation used and record its output instead. See `docs/agents/demonstrated-red.md`.
