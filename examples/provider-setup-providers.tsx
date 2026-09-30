import * as Player from '@playdeck/react';
import type {
  ProviderAdapterFactory,
  ProviderRegistration
} from '@playdeck/react';

// A source kind this package ships no loader for. Everything past this point
// is the shape any consumer's own provider takes: a source object of its own,
// and a lazy factory that turns it into a running ProviderAdapter — the same
// interface `@playdeck/provider-hls` and the other four built-in packages
// already produce.
type ExampleSource = { readonly type: 'example'; readonly clipId: string };
type ExampleOptions = { readonly quality?: 'sd' | 'hd' };

// Declared rather than implemented: this file exists to type-check the shape
// `providers` takes, not to ship a real adapter. A real one attaches to the
// mount point, drives playback, and reports state back through the same
// ProviderAdapter interface `createNativeProvider` and friends implement.
declare const createExampleAdapter: ProviderAdapterFactory<
  ExampleSource,
  ExampleOptions
>;

const exampleProvider: ProviderRegistration<ExampleSource, ExampleOptions> = {
  // Turns a URL none of the five built-in kinds recognise into the source
  // object above, or declines by returning undefined.
  detect: (url) => {
    const match = /^https:\/\/example\.com\/clips\/([\w-]+)$/.exec(url);
    return match ? { type: 'example', clipId: match[1]! } : undefined;
  },
  // Lazy: `load` is only called once a source of this kind actually needs
  // it, the same way this package's own dynamic `import('@playdeck/provider-hls')`
  // never runs for a page that plays nothing but MP4.
  load: () => Promise.resolve(createExampleAdapter)
};

export const ExampleProviderClip = () => (
  <Player.Root
    providerOptions={{ example: { quality: 'hd' } }}
    providers={{ example: exampleProvider }}
    source="https://example.com/clips/tracer"
  >
    <Player.Viewport>
      <Player.Media />
    </Player.Viewport>
  </Player.Root>
);
