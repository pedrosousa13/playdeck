# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

These exist as team labels on the **Side projects** team in Linear.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Category labels

Alongside its state label, every issue gets exactly one category label — except the `spec` issues described below. These also exist as team labels on **Side projects**:

| Label         | Meaning                          |
| ------------- | -------------------------------- |
| `Feature`     | New capability                   |
| `Improvement` | Enhancement to existing behavior |
| `Bug`         | Something is wrong               |

Use these exact names — not `enhancement`, not lowercase `bug`.

## Issues outside the state machine

`spec` is a team label on **Side projects**, not one of the triage labels above. In this repo it marks a durable contract or umbrella document — not a unit of work — and such an issue carries none of the labels above: no state role, no category label. It is exempt, not untriaged. `ready-for-agent` in particular would queue a document for implementation.

The Queue ignores such an issue by construction: selection requires `ready-for-agent`, which it does not carry. A triage sweep has no such guarantee — it must apply this exemption deliberately, which is what this section is here for.
