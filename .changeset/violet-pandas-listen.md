---
'@playdeck/react': patch
---

Stop `Controls` restoring focus into the region after a consumer removes its own focused control

`Controls` remembers that focus was inside its region so it can restore focus when a capability-gated control unmounts while focused. That memory survived a removal the region did not cause -- a consumer's own conditional render (`{show && <button/>}`) dropping its own focused control to `<body>` -- because the restore only ever ran on a capability-signature change, and nothing else ever cleared the memory once a blur's deferred check found the abandoned node still connected. A later, unrelated capability change (seek becoming available, say) then pulled focus back into the player, possibly long after the user had moved on.

A second effect, declared right after the restore effect and with no dependency array, runs after every commit: if focus is still remembered as within the region and landed on `<body>`, nothing restored it this commit, so the memory is stale and is cleared. A legitimate restore already moves focus off `<body>` earlier in the same commit, so it is unaffected -- a capability change that removes the focused control, a Playdeck part or a consumer's own control gated on its own capability read, restores focus into the region.
