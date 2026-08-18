# Issue #7 exploration brief: verification and bundle surface

Repository: `/Users/pedrosousa/Documents/projects/experiments/video-player`

Read-only task. Do not edit files, create commits, install dependencies, or change GitHub state.

Read:

- GitHub issue #7 via `gh issue view 7 --repo pedrosousa13/playdeck`
- Root scripts/configuration (`package.json`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`)
- Existing React/core/provider tests
- Existing docs app and e2e fixtures
- Current placeholder `test:bundle`

Map the minimum failing-first verification strategy for issue #7:

1. Unit/component tests for all three strategies, incompatibility errors, one-click behavior, and stale async results.
2. Network assertions for zero provider requests before interaction.
3. A real native-only bundle fixture and how to prove inactive provider code is absent from the initial graph and never requested.
4. SSR coverage and documentation changes.
5. Commands that should form the issue's verification gate.
6. Risks from pnpm 11 strict build approval and existing CI/browser setup.

Return a concise test/fixture plan with exact likely file paths. Identify checks that can reuse existing infrastructure versus checks requiring new files. Do not implement.
