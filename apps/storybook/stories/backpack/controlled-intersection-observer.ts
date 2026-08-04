import { vi, type Mock } from 'vitest';

/**
 * A controllable `IntersectionObserver` for the wrapper's contract tests: it
 * records every instance made and lets a test report an entry as a scroll would,
 * in either direction.
 *
 * Taken from `packages/react/test/activation.test.tsx:30-72` and extended there
 * to report a *non*-intersecting entry too, because scrolling out is half of what
 * `off-screen-pause.ts` does. `init` is kept verbatim, rather than only the
 * normalised `root`/`thresholds` properties, so a test can assert what its
 * subject asked the browser for — and, where a video has two observers on it,
 * tell which one it is holding.
 *
 * A test-only module in the same directory as the tests that use it, alongside
 * `reporting-provider.ts`. Earlier revisions carried a copy of this class in each
 * contract test with a comment claiming a stub for a browser API neither package
 * owns had no home short of a new module; that reason did not survive
 * `reporting-provider.ts` existing, so the class moved here and the comment went.
 *
 * `packages/react/test/activation.test.tsx` keeps its own simpler copy. It is in
 * another package, and a package's tests importing a helper out of an app in this
 * workspace would invert the dependency — `@reely/react` knows nothing about
 * `@reely/storybook`, and this is not the place to make it start.
 */
export class ControlledIntersectionObserver implements IntersectionObserver {
  static instances: ControlledIntersectionObserver[] = [];
  readonly init: IntersectionObserverInit;
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds: ReadonlyArray<number>;
  private readonly callback: IntersectionObserverCallback;
  private target?: Element;

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {}
  ) {
    this.callback = callback;
    this.init = options;
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds =
      typeof options.threshold === 'number'
        ? [options.threshold]
        : (options.threshold ?? [0]);
    ControlledIntersectionObserver.instances.push(this);
  }

  // Annotated rather than inferred: this module is compiled as part of the
  // workspace's project references, where an inferred `vi.fn()` type cannot be
  // named without reaching into `@vitest/spy`'s internals (TS2883). The copies
  // this replaced were local to their test files and never hit that.
  disconnect: Mock<() => void> = vi.fn();
  observe: Mock<(target: Element) => void> = vi.fn((target: Element) => {
    this.target = target;
  });
  takeRecords = () => [];
  unobserve: Mock<(target: Element) => void> = vi.fn();

  /** Reports the observed target as intersecting or not, as a scroll would. */
  emit(isIntersecting: boolean) {
    const target = this.target!;
    this.callback(
      [
        {
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRatio: isIntersecting ? 1 : 0,
          intersectionRect: target.getBoundingClientRect(),
          isIntersecting,
          rootBounds: null,
          target,
          time: 0
        }
      ],
      this
    );
  }
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

/**
 * Installs the stub globally and clears the instance list, for a `beforeEach`.
 * Clearing is what keeps a test's "how many observers exist" assertions about
 * its own render rather than about the whole file's.
 */
export const installObserver = (): void => {
  ControlledIntersectionObserver.instances = [];
  globalThis.IntersectionObserver =
    ControlledIntersectionObserver as unknown as typeof globalThis.IntersectionObserver;
};

/** Puts the real constructor back, for an `afterEach`. */
export const restoreObserver = (): void => {
  globalThis.IntersectionObserver = originalIntersectionObserver;
};
