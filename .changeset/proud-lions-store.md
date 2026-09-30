---
'@playdeck/react': patch
---

Copying a supplied source object, and sanitising a supplied kind's own `providerOptions` bag, both store a field keyed literally `__proto__` as an ordinary own data property, the same as any other field. Neither copy's own prototype ever becomes a value the input supplied.
