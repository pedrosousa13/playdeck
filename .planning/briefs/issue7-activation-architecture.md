# Issue #7 exploration brief: activation architecture

Repository: `/Users/pedrosousa/Documents/projects/experiments/video-player`

Read-only task. Do not edit files, create commits, or change GitHub state.

Read:

- GitHub issue #7 via `gh issue view 7 --repo pedrosousa13/playdeck`
- `packages/core/src/index.ts`
- `packages/react/src/index.tsx`
- `packages/provider-native/src/index.ts`
- Relevant tests under those packages

Determine the smallest architecture that satisfies issue #7:

1. Where provider activation currently happens and which interfaces already exist.
2. How to add `eager`, `viewport`, and `interaction` without conflating poster loading or media preload.
3. How a provider-loader registry and test-only fake-loader seam should be shaped without exporting speculative public API.
4. How source-change generation invalidation and SSR behavior should work.
5. Which visual activation button/loading/error elements issue #7 necessarily creates for later Storybook stories.
6. Exact likely files to create or modify.

Return a concise design recommendation, alternatives considered, and any contract ambiguity. Cite file paths and line numbers. Do not implement.
