import { renderHook, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearThumbnailCache,
  thumbnailEndpoint,
  useVideoThumbnail
} from './video-thumbnail';

describe('thumbnailEndpoint', () => {
  it('maps a YouTube watch URL to its oEmbed endpoint', () => {
    expect(
      thumbnailEndpoint('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    ).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DmhN3E_hlWmU&format=json'
    );
  });

  it('maps a youtu.be URL to the canonical watch?v= oEmbed endpoint', () => {
    expect(thumbnailEndpoint('https://youtu.be/mhN3E_hlWmU')).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DmhN3E_hlWmU&format=json'
    );
  });

  it('normalises a Shorts URL to watch?v= before it reaches the endpoint', () => {
    expect(
      thumbnailEndpoint('https://www.youtube.com/shorts/mhN3E_hlWmU')
    ).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DmhN3E_hlWmU&format=json'
    );
  });

  it('maps a YouTube embed URL to the canonical watch?v= oEmbed endpoint', () => {
    // Regression for the divergence with `detectSource`: the old substring
    // matcher never recognised `/embed/` and returned no endpoint at all, so
    // an embedded video played with no cover under `light: true`.
    expect(
      thumbnailEndpoint('https://www.youtube.com/embed/dQw4w9WgXcQ')
    ).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ&format=json'
    );
  });

  it('maps a Vimeo URL to its oEmbed endpoint at a larger width', () => {
    expect(thumbnailEndpoint('https://vimeo.com/336066147')).toBe(
      'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F336066147&width=1280'
    );
  });

  it('returns undefined for a URL that only has "vimeo.com" as a path segment on another host', () => {
    // Regression: the old unanchored substring matcher fired Vimeo's oEmbed
    // for this, even though `detectSource` rejects it outright.
    expect(
      thumbnailEndpoint('https://example.com/vimeo.com/1')
    ).toBeUndefined();
  });

  it('returns undefined for a URL that only has "vimeo.com" in its query string', () => {
    expect(
      thumbnailEndpoint('https://attacker.example/?ref=vimeo.com/x')
    ).toBeUndefined();
  });

  it('returns undefined for a Wistia URL', () => {
    expect(
      thumbnailEndpoint('https://reely.wistia.com/medias/oifkgmxnkb')
    ).toBeUndefined();
  });

  it('returns undefined for a plain file URL', () => {
    expect(thumbnailEndpoint('https://example.com/tracer.mp4')).toBeUndefined();
  });

  it('returns undefined for a non-URL string', () => {
    expect(thumbnailEndpoint('not a url')).toBeUndefined();
  });
});

describe('useVideoThumbnail', () => {
  const originalFetch = globalThis.fetch;

  // A module-level cache otherwise leaks a thumbnail (or its absence) between
  // tests that share an endpoint string, since the cache does not know it is
  // under test.
  beforeEach(() => {
    clearThumbnailCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the placeholder immediately and never calls fetch', () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail(
        'https://www.youtube.com/watch?v=mhN3E_hlWmU',
        'https://example.com/cover.jpg'
      )
    );

    expect(result.current).toBe('https://example.com/cover.jpg');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves a YouTube URL to the fetched thumbnail_url', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          thumbnail_url: 'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg'
        })
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    );

    await waitFor(() =>
      expect(result.current).toBe(
        'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg'
      )
    );
  });

  it('resolves a rejected fetch to undefined and throws nothing', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it('resolves a response with no thumbnail_url to undefined', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it('resolves a non-OK oEmbed response to undefined', async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({ thumbnail_url: 'https://example.com/never.jpg' })
    });
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    );

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(result.current).toBeUndefined();
  });

  it('drops the previous source thumbnail when the url changes', async () => {
    const youtubeThumbnail = 'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg';
    const vimeoThumbnail = 'https://i.vimeocdn.com/video/336066147.jpg';
    const fetch = vi.fn((endpoint: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            thumbnail_url: endpoint.includes('vimeo')
              ? vimeoThumbnail
              : youtubeThumbnail
          })
      })
    );
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { rerender, result } = renderHook(
      ({ url }: { url: string }) => useVideoThumbnail(url),
      { initialProps: { url: 'https://www.youtube.com/watch?v=mhN3E_hlWmU' } }
    );

    await waitFor(() => expect(result.current).toBe(youtubeThumbnail));

    // The previous provider's thumbnail must not survive the source change,
    // not even until the new lookup lands.
    rerender({ url: 'https://vimeo.com/336066147' });
    expect(result.current).not.toBe(youtubeThumbnail);

    await waitFor(() => expect(result.current).toBe(vimeoThumbnail));
  });

  it('never calls fetch for a source with no endpoint', () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useVideoThumbnail('https://reely.wistia.com/medias/oifkgmxnkb')
    );

    expect(result.current).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never calls fetch when url is undefined', () => {
    const fetch = vi.fn();
    globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

    const { result } = renderHook(() => useVideoThumbnail(undefined));

    expect(result.current).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  describe('thumbnail host allowlist', () => {
    it('accepts a YouTube thumbnail_url on img.youtube.com', async () => {
      const thumbnail = 'https://img.youtube.com/vi/mhN3E_hlWmU/hqdefault.jpg';
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ thumbnail_url: thumbnail })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const { result } = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );

      await waitFor(() => expect(result.current).toBe(thumbnail));
    });

    it('rejects a YouTube thumbnail_url on a host outside the allowlist', async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ thumbnail_url: 'https://evil.example/hq.jpg' })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const { result } = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );

      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(result.current).toBeUndefined();
    });

    it('rejects a YouTube thumbnail_url served over http', async () => {
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            thumbnail_url: 'http://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg'
          })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const { result } = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );

      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(result.current).toBeUndefined();
    });

    it('rejects a Vimeo thumbnail_url on a YouTube image host', async () => {
      // A Vimeo endpoint must not accept a ytimg.com thumbnail — the
      // allowlist is matched per provider, not pooled across both.
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            thumbnail_url: 'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg'
          })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const { result } = renderHook(() =>
        useVideoThumbnail('https://vimeo.com/336066147')
      );

      await waitFor(() => expect(fetch).toHaveBeenCalled());
      expect(result.current).toBeUndefined();
    });

    it('accepts a Vimeo thumbnail_url on vimeocdn.com', async () => {
      const thumbnail = 'https://vimeocdn.com/video/336066147.jpg';
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ thumbnail_url: thumbnail })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const { result } = renderHook(() =>
        useVideoThumbnail('https://vimeo.com/336066147')
      );

      await waitFor(() => expect(result.current).toBe(thumbnail));
    });
  });

  describe('caching', () => {
    it('does not refetch when the same source mounts twice', async () => {
      const thumbnail = 'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg';
      const fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ thumbnail_url: thumbnail })
      });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const first = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );
      await waitFor(() => expect(first.result.current).toBe(thumbnail));

      const second = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );
      await waitFor(() => expect(second.result.current).toBe(thumbnail));

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('evicts the cache entry after a failed lookup so a later mount retries', async () => {
      const thumbnail = 'https://i.ytimg.com/vi/mhN3E_hlWmU/hqdefault.jpg';
      const fetch = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ thumbnail_url: thumbnail })
        });
      globalThis.fetch = fetch as unknown as typeof globalThis.fetch;

      const first = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      // Flushes the cached promise's own `.catch().then(evict)` chain, which
      // runs before the hook's state update, so the entry is gone by the
      // time the next mount looks it up.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      first.unmount();

      const second = renderHook(() =>
        useVideoThumbnail('https://www.youtube.com/watch?v=mhN3E_hlWmU')
      );
      await waitFor(() => expect(second.result.current).toBe(thumbnail));

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
