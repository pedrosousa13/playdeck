// @vitest-environment happy-dom

// Unit tests for shim-shared.ts's `transform`, and for the two public
// entry points that apply it (jsx-runtime-18.ts's `jsx`, react-shim-18.ts's
// `createElement`) -- the two places `../react/src`'s compiled output
// actually reaches it (see jsx-runtime-18.ts and react-shim-18.ts's own
// headers for which JSX shape reaches which).
//
// These run under this package's own pinned React 18.3.1 devDependency
// (resolved by plain node_modules lookup from a file under
// packages/react-18, ahead of the workspace's hoisted 19.3.0 -- see
// vitest.config.ts's header for the same resolution-order concern against
// files OUTSIDE this package), not through packages/react-18/vitest.config.ts's
// shim-and-pin plugin: these files exercise the shims directly, so nothing
// here needs that plugin's redirection.
import { cleanup, render } from '@testing-library/react';
import { version as reactVersion, type ReactElement } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createElement } from '../src/react-shim-18';
import { jsx } from '../src/jsx-runtime-18';
import { transform } from '../src/shim-shared';

afterEach(cleanup);

describe('host callback ref', () => {
  test('a cleanup it returns on attach runs once on detach, and the original is never called with null', () => {
    const cleanupFn = vi.fn();
    const original = vi.fn().mockReturnValue(cleanupFn);
    const node = {};

    const [, props] = transform('div', { ref: original }) as [
      unknown,
      { ref: (node: unknown) => void }
    ];
    const wrapped = props.ref;

    wrapped(node);
    expect(original).toHaveBeenCalledExactlyOnceWith(node);

    wrapped(null);
    expect(cleanupFn).toHaveBeenCalledOnce();
    // The one behaviour this wrapper exists to change: React 18 would
    // otherwise call `original` a second time, with `null`, instead of
    // the cleanup it returned.
    expect(original).toHaveBeenCalledOnce();
  });

  test('with no cleanup returned, the original is called with null on detach', () => {
    const original = vi.fn().mockReturnValue(undefined);
    const node = {};

    const [, props] = transform('div', { ref: original }) as [
      unknown,
      { ref: (node: unknown) => void }
    ];
    const wrapped = props.ref;

    wrapped(node);
    wrapped(null);

    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenNthCalledWith(1, node);
    expect(original).toHaveBeenNthCalledWith(2, null);
  });
});

describe('plain function component given a ref', () => {
  test('receives it, through the jsx() path', () => {
    let receivedRef: unknown;
    const Plain = (props: { ref?: unknown }) => {
      receivedRef = props.ref;
      return null;
    };
    const refObject = { current: null };

    render(jsx(Plain, { ref: refObject }) as ReactElement);

    expect(receivedRef).toBe(refObject);
  });

  test('receives it, through the createElement() path', () => {
    let receivedRef: unknown;
    const Plain = (props: { ref?: unknown }) => {
      receivedRef = props.ref;
      return null;
    };
    const refObject = { current: null };

    render(createElement(Plain, { ref: refObject }) as ReactElement);

    expect(receivedRef).toBe(refObject);
  });
});

describe('wrapper identity', () => {
  test('transform returns the same wrapped host ref across calls with the same original callback', () => {
    const original = () => undefined;
    const [, firstProps] = transform('div', { ref: original }) as [
      unknown,
      { ref: unknown }
    ];
    const [, secondProps] = transform('div', { ref: original }) as [
      unknown,
      { ref: unknown }
    ];

    expect(firstProps.ref).toBe(secondProps.ref);
  });

  test('a stable callback ref is attached once across a re-render, not detached and reattached', () => {
    const calls: unknown[] = [];
    const original = (node: unknown) => {
      calls.push(node);
    };

    const { rerender } = render(
      createElement('div', { ref: original }) as ReactElement
    );
    expect(calls.length).toBe(1);

    rerender(createElement('div', { ref: original }) as ReactElement);
    expect(calls.length).toBe(1);
  });
});

describe('img fetchPriority', () => {
  test('transform renames it to the fetchpriority attribute', () => {
    const [, props] = transform('img', { fetchPriority: 'high' });
    expect(props).not.toHaveProperty('fetchPriority');
    expect((props as Record<string, unknown>).fetchpriority).toBe('high');
  });

  test('reaches the DOM as fetchpriority, with no React warning', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container } = render(
      createElement('img', { fetchPriority: 'high', alt: '' }) as ReactElement
    );

    expect(container.querySelector('img')?.getAttribute('fetchpriority')).toBe(
      'high'
    );
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

// Confirms this suite runs against the real, pinned React 18.3.1, not the
// workspace's hoisted React 19 -- a wrong resolution would make the
// fetchPriority and callback-ref-cleanup assertions above pass for the wrong
// reason, since React 19 already tolerates both on its own.
test('resolves the real, pinned React 18.3.1', () => {
  expect(reactVersion).toBe('18.3.1');
});
