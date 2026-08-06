# Cross-provider options live on Root, not in a per-provider bag

Reely reaches a provider's own settings through one prop: `Root`'s
`providerOptions`, one bag per provider
(`packages/react/src/provider-loaders.ts`'s `PlayerProviderOptions`). Wistia's
player colour goes in the `wistia` bag, YouTube's embed host in the `youtube`
bag, and the loader hands each provider the bag with its name on it. "Let the
provider draw its own controls" could have been one more key in each of those
bags — Vimeo, YouTube and Wistia all accepted one already, each written before
anything on `Root` could ask for it. SIDEPRO-223 gave it a prop on `Root`
instead, fanned out from there to whichever provider the source resolves to.

A bag key makes a consumer write a cross-provider answer once per provider. A
page that plays whatever a CMS hands it does not know which provider it will
get, so "show the provider's controls" becomes
`{ vimeo: { controls: true }, youtube: { controls: true }, wistia: { controls: true } }`
— three keys for one intention, and no way at all to say it for a native or HLS
source, which has no bag. Miss one and nothing warns: an absent key is a
default, the default is chromeless, and the consumer gets a bare video on
exactly the source they forgot. That is the worst shape a mistake can take,
and a per-provider bag hands out one instance of it per provider a consumer
does not enumerate. A prop on `Root` cannot be missed, because there is one of
it.

What that costs is the fan-out, and `Root` pays it rather than the consumer:
`Root` folds the value into the bag belonging to the detected source's own
provider (`root.tsx`'s `resolvedProviderOptions`) and threads it through
`PlayerContext` for a native or HLS source, where `Media` writes it as the
`<video>` element's own `controls` attribute. That is more code than a bag key
needs, and it is code a new provider adds to.

The two homes are mutually exclusive by construction rather than by convention.
`PlayerProviderOptions` omits `controls` from its `youtube` and `vimeo` bags at
the type level, and `Media` omits it from its own props, so the prop is the only
place the setting can be written at all. The alternative was a documented
precedence rule — the prop wins over the bag key, or the reverse — and a
precedence rule is a question a consumer has to answer before they can predict
their own code: both spellings compile, both read as deliberate in a diff, and
only one of them does anything. Making the second spelling unrepresentable
removes the question instead of answering it, and it removes it at the point the
code is written rather than at the point the video renders wrong.

## The boundary

- **Reely-level, a prop on `Root`** — every provider has an answer to it. The
  answers may arrive by different mechanisms — an embed URL parameter for Vimeo
  and YouTube, a DOM attribute for native and HLS — but no provider is silent
  about the concept. `controls` is one. So is `loop`, below.
- **Per-provider, a key in that provider's bag** — only that provider's embed
  has the concept, so the others have nothing to answer: Wistia's `playerColor`
  and `swatch`, YouTube's `host`, Vimeo's `dnt`.
- The test is the concept, not a count of providers. Two providers sharing an
  option the rest have no notion of is still per-provider, and it belongs in both
  bags.

**`loop` is Reely-level by this boundary, and SIDEPRO-210 made it behave as
though it is.** It was already a `Root` prop, and every provider has an answer
to it: Wistia's implements it by setting `endVideoBehavior`
(`provider-wistia/src/attachment.ts`'s `if (options.loop === true)`), Vimeo's
embed takes a `loop` URL parameter and YouTube's takes a `loop` player parameter
(with a `playlist` companion, for a single video), and a `<video>` element has
the attribute. But it used to reach native and HLS only, because it travelled
inside `NativePlaybackOptions`, which `loadProvider` hands to those two
providers and to no others — so `loop: true` on a Vimeo or YouTube source was
the same silent no-op this decision exists to prevent, arrived at from the
opposite direction: a Reely-level prop that fans out to some providers instead
of a per-provider key that a consumer forgets. It now takes the `controls`
route as well: `resolvedProviderOptions` folds it into the active provider's own
bag, and `PlayerProviderOptions` omits it from all three, so
`providerOptions={{ wistia: { loop: true } }}` — the one spelling that used to
work — no longer compiles.

## Consequences

- A new Reely-level option is work in every provider rather than in one. Ship the
  prop without an answer for some provider and it is a silent no-op on that
  provider — the failure the boundary exists to prevent, now inside the library
  instead of in a consumer's option bag.
- Wistia is the first instance of that cost, and it is unpaid. SIDEPRO-223 fanned
  `controls` out to Vimeo, YouTube, native and HLS, and put Wistia out of scope,
  so `controls` on `Root` does nothing to a `<wistia-player>` today. Its bag
  still carries `controls` un-omitted, because the fan-out does not reach it —
  which means the one provider the prop cannot serve is also the one where the
  double home survives, and the only spelling that works there is the spelling
  this ADR calls wrong. Closing it is a fold in `resolvedProviderOptions` and an
  `Omit` in the bag, in that order.
- The fan-out is not uniform, and a consumer can observe that. Folding `controls`
  into a bag makes a change to it look like a provider-option change, which
  re-attaches a Vimeo or YouTube embed — it must, the value being baked into the
  embed URL — where a native or HLS element only has an attribute set and keeps
  its playback position. Toggling `controls` mid-playback is therefore cheap on
  one source and a reload on another. `loop` is not a second instance of this
  cost. It rides in `NativePlaybackOptions`, which the activation identity
  compares on every source type rather than only the two that read it, so a
  change to it already rebuilt the provider before SIDEPRO-210 folded it into
  the bags. The fold changed what that rebuild produces, not whether it
  happens.
- Where a composition used to write the bag key, it now writes the prop once.
  The `backpack-parity` branch's Backpack wrapper is the worked example: it
  wrote `youtube: { controls }` for one provider, drew its own
  `Player.Controls` over whatever chrome that produced, and SIDEPRO-222 found
  the two bars that made on YouTube. Wistia's fan-out is what is left undone.
- An option that starts per-provider and turns out to be cross-provider cannot
  move quietly: the bag key is public API, so relocating it to a prop is a
  breaking change for anyone who wrote it. The boundary is worth applying when
  the option is added, not when the second provider grows the same concept.
