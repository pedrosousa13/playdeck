# Provider posters

**Goal:** the bench shows the poster a provider already has, instead of one this
repository cuts by hand and serves.

**Status:** plan only. Nothing here is built, and two decisions at the end are
the maintainer's.

---

## What is true today

The poster is entirely the consumer's problem. `Player.Poster` and
`Player.PosterImage` render whatever URL they are handed, `ResponsivePoster`
carries `src`, `srcSet` and `sizes`, and nothing anywhere asks a provider what
picture it would use. The one provider that mentions posters is Wistia, and it
takes one as an *option a consumer passes*, checks it against the shared
allowlist, and publishes a notice when it is refused.

So the library has a poster **sink** and no poster **source**.

The site currently fills that sink by hand: `ffmpeg` cuts a frame out of the
film, two WebP files are committed, and `startTime` is set so the still and the
first played frame are the same instant.

## Why this is a library question and not only a page one

The four providers disagree about posters in a way that is this library's whole
subject:

| Provider | Where its poster comes from | Cost to discover |
| --- | --- | --- |
| YouTube | `i.ytimg.com/vi/<id>/maxresdefault.jpg`, derivable from the id alone | none |
| Vimeo | `thumbnail_url` from oembed or the API | one request |
| Wistia | derivable from the media id through their API | one request |
| native | the file has none | not applicable |
| HLS | the manifest has none | not applicable |

That is a real asymmetry, it is knowable, and the library currently reports none
of it. A consumer who wants "just use the provider's poster" has to write four
different pieces of code and know which two are impossible.

**This is worth filing against the library regardless of what the page does.**
The shape that fits the existing design is a capability plus a value: something
like `capabilities.providerPoster` answering `available`, `unknown` or
`unavailable` with the reason the type already defines, and the resolved URL on
the snapshot when there is one. `native` and `hls` would answer `unavailable`
with reason `source`, which is exactly what that reason means and is more useful
than silence.

## The three ways the page could do it

### A. Resolve at runtime, load from the provider's CDN

The island derives the YouTube URL from the id, and calls oembed for Vimeo.

Cheapest to build and always current. Costs a third-party request before any
press, and for Vimeo costs two: one to discover the URL and one to fetch the
image. The discovery request is the bad one, because it happens on load and
gets nothing on screen.

### B. Resolve at build, load from the provider's CDN (recommended)

A script resolves each ready source's poster URL at build time and writes the
results into a generated module. The page renders the provider's own CDN URL
directly.

No discovery request at runtime, no image bytes in this repository, and the
poster is genuinely the provider's. The build gains a network dependency, so
the generated file is committed and the script is a refresh rather than a
requirement, the way `scripts/docs-examples.mjs` already treats generated
content. The asymmetry above becomes visible in one place instead of implied.

### C. Resolve and download at build, serve same-origin

As B, then fetch the image and emit it into `public/`.

Keeps every byte first-party and keeps the at-rest silence intact. But it is
what the page does today with extra steps, and it means this repository stores
somebody else's artwork, which is a licensing question the current hand-cut
frame does not have.

## What this costs, stated plainly

**The still stops matching the first played frame.** A provider's thumbnail is
the frame the uploader chose or the key art they designed. `startTime` is
currently set so the poster and the first frame agree, and a provider poster
breaks that. Either `startTime` goes to zero and the film starts at its title
card, or the page accepts that the still is cover art rather than a frame.

Both are defensible. Every YouTube embed on the web has this property and no
reader is confused by it. It is worth naming because two rounds of work went
into making the poster and the playback agree, and this undoes that on purpose
rather than by accident.

**The resting line has to change, and this is the part that needed the
maintainer's ruling rather than mine.** It currently reads "No video has loaded
yet. No provider has been contacted", and `e2e/site-quiet.spec.ts` asserts no
request leaves this origin at rest.

The maintainer's position: `loading="interaction"` is one mode a consumer picks,
not a property of the library, and the page does not owe it an absolute defence.
That is right, and it suggests something better than defending it. **The page
should show the mode.** `loading="interaction"` becomes a printed prop in the
composition panel, the resting line says what that mode does rather than what
this page happens not to have done, and the claim stops being a boast about one
page and becomes a demonstration of a prop a reader can copy.

The at-rest test then changes from "nothing leaves this origin" to "no
*provider* request leaves before a press", which is the claim the prop actually
makes and is still worth gating.

## Sequence, if B is chosen

1. File the library gap. It is the durable half and it is worth having open
   whatever the page does.
2. Add `scripts/resolve-provider-posters.mjs`: derives YouTube, oembeds Vimeo
   and Wistia, writes a generated module, and fails loudly rather than emitting
   a partial map.
3. Commit the generated output and add a check that it is current, in the shape
   `pnpm docs:check` already uses for generated content.
4. Point `bench-sources.ts`'s poster field at the resolved URL, keeping the
   bundle shape so a provider still cannot arrive without one.
5. Delete the two committed WebP files and the `ffmpeg` provenance comment.
6. Decide `startTime`, per the trade above.
7. Print `loading="interaction"` in the composition and rewrite the resting line
   around the mode.
8. Amend `e2e/site-quiet.spec.ts` from origin-silence to provider-silence, and
   say in the spec why the assertion narrowed.

## Best practice, and why this should be options rather than a choice

The pattern is a facade, also called a lite embed: show the provider's still,
load nothing else, and mount the real iframe only on a press.
`lite-youtube-embed` is the canonical implementation and Vimeo ships its own.
**`loading="interaction"` is that pattern**, so this library already does the
hard half of it and simply has no thumbnail to show.

Loading the still from the provider's CDN at runtime is what almost everyone
does. Self-hosting it is the privacy-hardened variant, common on European sites,
because `i.ytimg.com` sets no cookie but does hand the visitor's IP to Google
before they have asked for anything.

Neither is wrong. Which one a consumer wants is a policy decision about their
own users, and a library that picks for them is making that decision silently.
So the answer is not to choose, it is to offer both and report what each
provider can do.

`Player.Root`'s `poster` prop already takes a URL or a `ResponsivePoster`. It
should also take `'provider'`, meaning resolve it from whatever is playing. Then
`capabilities.providerPoster` answers whether that is even possible, in the
vocabulary `Availability` already defines:

| Provider | Answer | Why |
| --- | --- | --- |
| YouTube | `available` | derivable from the id, costs nothing |
| Vimeo | `unknown: 'provider-check'`, then `available` | has one, must be asked |
| Wistia | `unknown: 'provider-check'`, then `available` | has one, must be asked |
| native | `unavailable: 'source'` | a file has no poster |
| HLS | `unavailable: 'source'` | a manifest has none |

Nothing new is invented for that. `provider-check` already means "we have to ask
the provider", which is exactly the difference between a poster that is free and
one that costs a round trip, and `source` already means the media does not offer
it. The type was built for this shape.

**One implementation trap, recorded so it is not rediscovered.**
`maxresdefault.jpg` does not exist for every YouTube video and 404s silently
where it does not; `hqdefault.jpg` always exists. A resolver that reaches for the
larger file without a fallback ships a broken poster on older uploads, and it
will look like a page defect rather than a resolver one.

## Decided

**The library gets the feature and the page does not wait for it.** Ruled by the
maintainer after the best-practice section above made the shape obvious.

Splitting it this way is deliberate. `#542` has been open through five
rejections of the landing page, and folding a provider-adapter feature into that
branch makes it a much larger thing to review for no benefit: the page change is
small and it is cheap to redo once the library can do it properly.

So:

- **The library issue is filed now** and carries the whole design: `poster` also
  accepting `'provider'`, `capabilities.providerPoster` answering in the
  vocabulary `Availability` already defines, and the `maxresdefault` fallback
  trap. That is the durable half and it belongs to the package rather than to
  one page.
- **The page wires the provider URLs directly, on this branch**, and adopts
  `poster="provider"` when it exists. Option A from above rather than B: with
  the at-rest silence no longer something the page owes an absolute defence,
  build-time resolution buys nothing that runtime resolution does not, and it
  costs a generated file, a check that it is current, and a network dependency
  in the build. A YouTube URL derives from the id with no request at all, and
  Vimeo's one oembed call happens on a page that is about to load an embed
  anyway.

**Still open, and it is the smaller question:** whether `startTime` goes to zero
so the film starts where its poster does, or stays where it is and the poster
becomes cover art rather than a frame. Decide it against the rendered page, with
the provider's actual thumbnail on screen, rather than now.

## What changes on the page

1. `bench-sources.ts`'s poster field becomes the provider's URL rather than a
   path into `public/`. The bundle shape does not change, so a provider still
   cannot arrive without one.
2. `sprite-fright-poster-1024w.webp` and `-2048w.webp` are deleted, along with
   the `ffmpeg` provenance comment recording how they were cut.
3. The resting line stops claiming no provider has been contacted, because one
   has. It says what `loading="interaction"` does instead.
4. `loading="interaction"` becomes a printed prop in the composition panel, so
   the mode is a thing a reader can copy rather than a property of this page.
5. `e2e/site-quiet.spec.ts` narrows from "no request leaves this origin" to "no
   provider *media* request before a press", and the spec says why it narrowed.
   The poster request is expected and is not the thing the prop promises to
   avoid.
