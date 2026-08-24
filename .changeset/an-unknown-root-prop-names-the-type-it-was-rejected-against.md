---
'@playdeck/react': patch
'@playdeck/provider-native': patch
---

`RootProps` is now a single declared object type rather than
`NativePlaybackOptions & PlayerActivationProps & { ... }`. `Root` accepts exactly
the same twenty-five props, none added and none removed, and nothing it renders
moves — this changes only what a consumer's compiler prints when a prop is
rejected.

Compiled against the built declarations, an invented prop used to read:

```
error TS2322: Type '{ children: Element; ref: RefObject<PlayerHandle | null>; source: string; tracks: never[]; }' is not assignable to type 'IntrinsicAttributes & NativePlaybackOptions & PlayerActivationProps & { readonly autoplay?: AutoplayMode | undefined; ... 16 more ...; readonly volume?: number | undefined; }'.
  Property 'tracks' does not exist on type 'IntrinsicAttributes & NativePlaybackOptions & PlayerActivationProps & { readonly autoplay?: AutoplayMode | undefined; ... 16 more ...; readonly volume?: number | undefined; }'.
```

and now reads:

```
error TS2322: Type '{ children: Element; ref: RefObject<PlayerHandle | null>; source: string; tracks: never[]; }' is not assignable to type 'IntrinsicAttributes & RootProps'.
  Property 'tracks' does not exist on type 'IntrinsicAttributes & RootProps'.
```

**TypeScript still does not list the props it would have accepted**, and no shape
this library can declare makes it. It elides the members of an object type it
prints, and `--noErrorTruncation` does not change the output above either,
because what gets printed now is the alias rather than its members. What changes
is that the rejected type has a name, and that name is exported from
`@playdeck/react`: the error points at a declaration a consumer can open, rather
than at a flattened intersection that had lost the alias and named
`NativePlaybackOptions`, a type from a package
[the README](https://github.com/pedrosousa13/playdeck#readme) says nobody needs
to install.

`PlayerActivationProps` keeps its shape and its export. It is now
`Pick<RootProps, 'loadMargin' | 'loadThreshold' | 'loading' | 'preload'>`, so
those four props have one declaration between them rather than two.

**The JSDoc on `loop`, `startTime` and `endTime` now describes the props rather
than the plumbing that carries them.** These are `Root` props on every provider
([ADR-0004](https://github.com/pedrosousa13/playdeck/blob/main/docs/adr/0004-cross-provider-options-live-on-root.md)),
but their hover text lived in `@playdeck/provider-native` and opened by calling
itself the native and HLS route to the same prop, citing two bare issue numbers
— which is what a consumer on a YouTube source read when they hovered
`startTime`. Both the `Root` declaration and `NativePlaybackOptions` now say what
the prop does and which values it refuses. No behaviour and no type moved with
the text.
