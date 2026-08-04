import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { thumbnailEndpoint, useVideoThumbnail } from './video-thumbnail';

describe('thumbnailEndpoint', () => {
  it('maps a YouTube watch URL to its oEmbed endpoint', () => {
    expect(
      thumbnailEndpoint('https://www.youtube.com/watch?v=mhN3E_hlWmU')
    ).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DmhN3E_hlWmU&format=json'
    );
  });

  it('maps a youtu.be URL to its oEmbed endpoint', () => {
    expect(thumbnailEndpoint('https://youtu.be/mhN3E_hlWmU')).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fyoutu.be%2FmhN3E_hlWmU&format=json'
    );
  });

  it('normalises a Shorts URL to watch?v= before it reaches the endpoint', () => {
    expect(
      thumbnailEndpoint('https://www.youtube.com/shorts/mhN3E_hlWmU')
    ).toBe(
      'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DmhN3E_hlWmU&format=json'
    );
  });

  it('maps a Vimeo URL to its oEmbed endpoint at a larger width', () => {
    expect(thumbnailEndpoint('https://vimeo.com/336066147')).toBe(
      'https://vimeo.com/api/oembed.json?url=https%3A%2F%2Fvimeo.com%2F336066147&width=1280'
    );
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
});
