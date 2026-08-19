---
'@playdeck/react': minor
---

`Player.Root`'s `ref` now hands back a fresh object carrying exactly the members
`PlayerHandle` declares, and no longer the live `PlayerController` (#328).
`Object.assign(controller, { activateFromInteraction })` used to build the
handle, and `Object.assign` mutates and returns its target, so the ref held the
whole controller — the narrowing `PlayerHandle` describes existed in TypeScript
alone and was absent at runtime. The OWASP sweep on #245 reported it as **A01 /
broken access control**.

**This removes members that were reachable in a released version.** Off the ref,
`setProvider`, `setActivation`, `configureAutoplay`, `subscribeDimensions`,
`subscribeCues`, `getActiveCues`, `reportRefusedUrl` and the five `*WithOrigin`
commands now read `undefined`, and `handle.current instanceof PlayerController`
is now `false`. None was ever named by `PlayerHandle`, and the README has always
documented the `ref` as receiving a `PlayerHandle`, so no documented member
moved — but a consumer who reached past the type and called one of them is
broken by this, and that is the point of the change rather than a side effect of
it. Everything `PlayerHandle` names still works and still reaches the same live
player: the handle's members are plucked off the controller, so a command sent
through the ref is the same call it always was.

The declared surface being honest is the whole fix; stopping the caller was
never the goal. Per the issue's own impact bound, whoever holds the ref is
already running same-origin script and could reach the controller other ways —
no network input, no `postMessage` and no consumer-supplied prop leads here. What
the leak cost was truthfulness: a reviewer auditing what a vendor overlay can do
reads `PlayerHandle` and, before this, got the wrong answer. The failure shape
the issue records is a first-party wrapper handing the ref to a vendor overlay
typed against `PlayerHandle`, which could then swap the vetted adapter out with
`setProvider` or forge `PlayerEventOrigin: 'user'` on an API-initiated command
that a consumer's analytics or consent accounting reads as a real interaction.

The handle's command list is no longer hand-written twice. `Root` and
`usePlayerActions` now build it from one function in `player-context.ts`, so the
ref's surface and the hook's surface cannot drift — and the ref's drifting is
how a member leaks back out. `reportRefusedUrl` is the case that proved it can
happen: it landed on the controller after the narrowing was written (#330) and
was correctly left out of `PlayerHandle`, and the old handle exposed it anyway.

**In-repo callers that genuinely need the controller have one escape route**, and
it is not a new export. The handle carries a registered symbol,
`Symbol.for('playdeck.internal.controller')`, whose value is the controller. It
is installed with `Object.defineProperty` and so is non-enumerable: `Object.keys`
and `JSON.stringify` drop symbol keys outright, but object spread copies
enumerable ones, and `{...ref.current}` in a narrowing wrapper is exactly the
failure shape above. A `@playdeck/react/testing` entry point was the alternative
and was rejected — it would have added published surface and build configuration
while stopping nobody. The symbol is deliberately absent from this package's
`exports` map and from `PlayerHandle`, is not part of the public API, and is not
covered by semver. It exists so the Storybook mock-player decorator and this
package's own render helpers can stage a fake provider through `setProvider`, and
it is one greppable name rather than the whole controller by default.

It lands as `minor` rather than `patch` because a runtime surface a released
version handed out is smaller now. The React context path is unaffected and
always was: `usePlayerActions` already built a fresh narrowed object, `usePlayer`
is not re-exported from the package entry, and the `exports` map is `"."` plus
`"./theme.css"` only. `@playdeck/core` is untouched — no controller member
changed, and nothing was added to or removed from that package.
