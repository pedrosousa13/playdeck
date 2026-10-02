# Changesets

How a pending changeset under `.changeset/` is written, and what checks it.

## Present tense, never narration

A changeset's prose describes the change as the version installing it stands
— never how the code behaved before, or what changed on the way there. A bare
**"now"**, **"previously"**, and **"as before"** are the phrasings that read
as narrating history. "The provider retries once" is the shape; "the
provider now retries once" is not.

`pnpm test:changesets` (`scripts/check-changesets.mjs`) enforces this,
case-insensitively, over every pending `.changeset/*.md` file, and runs in
the CI `static` job.

## Front matter is exempt

The leading `---`-delimited block naming each bumped package and its bump
level is never prose and is never checked — a package named, say,
`@x/now-feature` is not a violation.

## Released CHANGELOGs are history

`changeset version` turns a landed changeset into a dated entry in a
package's `CHANGELOG.md`. That entry is a historical record once it exists
and is never rewritten to the present tense — the rule above governs only a
changeset that is still pending.
