// @vitest-environment happy-dom

import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef, useEffect, useState, type ReactNode } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  type CommandResult,
  PlayerController,
  type ProviderAdapter,
  type ProviderStateListener,
  type ProviderStatePatch
} from '@reely/core';
import * as Player from '../src/index';

afterEach(cleanup);

const ok = async (): Promise<CommandResult> => ({ ok: true });

const createAdapter = () => {
  const listeners = new Set<ProviderStateListener>();
  const setPlaybackRate = vi.fn(ok);
  const adapter: ProviderAdapter = {
    provider: 'native',
    attach: () => {},
    load: () => {},
    destroy: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    play: ok,
    pause: ok,
    setPlaybackRate
  };
  return {
    adapter,
    setPlaybackRate,
    emit: (patch: ProviderStatePatch) =>
      listeners.forEach((listener) => listener(patch))
  };
};

describe('whenReady on the player handle', () => {
  test('is exposed on the ref handle', async () => {
    const handle = createRef<Player.PlayerHandle>();
    render(
      <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
        <Player.Media />
      </Player.Root>
    );
    const controller = handle.current as unknown as PlayerController;
    const mock = createAdapter();

    // Typed access, not a cast: this is the point of the change.
    const ready = handle.current?.whenReady();

    act(() => {
      controller.setProvider(mock.adapter);
    });

    await expect(ready).resolves.toEqual({ ok: true });
  });

  test('is what makes a startup preference land instead of being refused', async () => {
    const handle = createRef<Player.PlayerHandle>();
    render(
      <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
        <Player.Media />
      </Player.Root>
    );
    const controller = handle.current as unknown as PlayerController;
    const mock = createAdapter();

    // The naive version of this -- calling straight away -- is refused,
    // which is the whole reason the signal exists.
    await expect(handle.current?.setPlaybackRate(0.25)).resolves.toEqual({
      ok: false,
      reason: 'not-ready'
    });

    const applied = handle.current
      ?.whenReady()
      .then(() => handle.current?.setPlaybackRate(0.25));

    act(() => {
      controller.setProvider(mock.adapter);
    });

    await expect(applied).resolves.toEqual({ ok: true });
    expect(mock.setPlaybackRate).toHaveBeenCalledWith(0.25);
  });

  test('is reachable through usePlayerActions', async () => {
    const handle = createRef<Player.PlayerHandle>();
    const Consumer = ({ children }: { readonly children?: ReactNode }) => {
      const actions = Player.usePlayerActions();
      const [state, setState] = useState('waiting');
      useEffect(() => {
        void actions.whenReady().then((result) => {
          setState(result.ok ? 'ready' : 'failed');
        });
      }, [actions]);
      return (
        <>
          <span data-testid="status">{state}</span>
          {children}
        </>
      );
    };

    render(
      <Player.Root loading="interaction" ref={handle} source="/tracer.mp4">
        <Consumer />
      </Player.Root>
    );
    const controller = handle.current as unknown as PlayerController;
    const mock = createAdapter();
    expect(screen.getByTestId('status').textContent).toBe('waiting');

    await act(async () => {
      controller.setProvider(mock.adapter);
    });

    expect(screen.getByTestId('status').textContent).toBe('ready');
  });
});
