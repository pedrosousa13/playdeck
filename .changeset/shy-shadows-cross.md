---
'@playdeck/react': patch
---

Read `Player.Controls`' shortcut targets through open shadow roots.

The shortcut layer reads every keydown's target through `composedPath()`,
so a real `<input>`, `<textarea>`, content-editable region, open menu,
arrow-owning widget or activation control inside an open shadow root is
judged as itself rather than as the shadow root's host.

Text entry and an open menu inside an open shadow root silence the layer
exactly as one outside a shadow tree does, and the typed character reaches
the field. In `global` mode, an arrow-owning widget -- a native radio or
range input, or an element carrying one of the WAI-ARIA composite-widget
roles -- keeps its own arrow keys whether that role sits on the widget
itself or on a light-DOM host wrapping the shadow content that answers the
key. Containment in the player boundary, for that same arrow exemption and
for the `global`-mode `PageUp`/`PageDown` rule, is decided through the
keydown's composed path rather than `Node.contains`, so a widget nested
inside the player through an open shadow root is recognised as inside it.
Space and Enter activation targets (a button, link or checkbox-shaped
control) get the same treatment. A closed shadow root exposes only its
host.
