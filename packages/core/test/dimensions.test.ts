import { describe, expect, test } from 'vitest';
import {
  PlayerController,
  type MediaDimensions,
  type ProviderAdapter
} from '../src/index';

const noopAdapter = (over: Partial<ProviderAdapter> = {}): ProviderAdapter => ({
  provider: 'native',
  attach: () => {},
  load: () => {},
  destroy: () => {},
  subscribe: () => () => {},
  ...over
});

const publishingAdapter = (
  over: Partial<ProviderAdapter> = {}
): {
  adapter: ProviderAdapter;
  publish: (dimensions: MediaDimensions | undefined) => void;
  unsubscribed: () => number;
} => {
  let publish: (dimensions: MediaDimensions | undefined) => void = () => {};
  let unsubscribed = 0;
  return {
    adapter: noopAdapter({
      subscribeDimensions: (listener) => {
        publish = listener;
        return () => (unsubscribed += 1);
      },
      ...over
    }),
    publish: (dimensions) => publish(dimensions),
    unsubscribed: () => unsubscribed
  };
};

describe('controller dimension channel', () => {
  test('replays undefined when no provider is attached', () => {
    const controller = new PlayerController();
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));
    expect(seen).toEqual([undefined]);
  });

  test('fans out dimensions from the attached provider', () => {
    const controller = new PlayerController();
    const { adapter, publish } = publishingAdapter();
    controller.setProvider(adapter);
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    publish({ width: 1080, height: 1920 });

    expect(seen.at(-1)).toEqual({ width: 1080, height: 1920 });
  });

  test('replays the last known dimensions to a late subscriber', () => {
    const controller = new PlayerController();
    const { adapter, publish } = publishingAdapter();
    controller.setProvider(adapter);
    publish({ width: 1080, height: 1920 });

    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    expect(seen).toEqual([{ width: 1080, height: 1920 }]);
  });

  // The specific defect this channel exists to prevent: a ratio outliving the
  // source it measured is worse than no ratio at all, because the consumer's
  // `var(--reely-media-aspect-ratio, 16 / 9)` fallback stops applying.
  test('clears the ratio when a new provider is set', () => {
    const controller = new PlayerController();
    const first = publishingAdapter();
    controller.setProvider(first.adapter);
    first.publish({ width: 1080, height: 1920 });
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    controller.setProvider(publishingAdapter().adapter);

    expect(seen.at(-1)).toBeUndefined();
  });

  test('clears the ratio when the provider is detached', () => {
    const controller = new PlayerController();
    const { adapter, publish } = publishingAdapter();
    controller.setProvider(adapter);
    publish({ width: 1080, height: 1920 });
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    controller.setProvider(undefined);

    expect(seen.at(-1)).toBeUndefined();
  });

  test('unsubscribes from the replaced provider channel', () => {
    const controller = new PlayerController();
    const first = publishingAdapter();
    controller.setProvider(first.adapter);

    controller.setProvider(publishingAdapter().adapter);

    expect(first.unsubscribed()).toBe(1);
  });

  test('ignores a publish from a provider that has been replaced', () => {
    const controller = new PlayerController();
    const first = publishingAdapter();
    controller.setProvider(first.adapter);
    controller.setProvider(publishingAdapter().adapter);
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    first.publish({ width: 1080, height: 1920 });

    expect(seen).toEqual([undefined]);
  });

  test('tolerates a provider with no dimension channel', () => {
    const controller = new PlayerController();
    const seen: (MediaDimensions | undefined)[] = [];
    controller.subscribeDimensions((dimensions) => seen.push(dimensions));

    controller.setProvider(noopAdapter());

    expect(seen.at(-1)).toBeUndefined();
  });
});
