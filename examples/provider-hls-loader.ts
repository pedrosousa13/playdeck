import { createHlsProvider } from '@playdeck/provider-hls';

declare const videoElement: HTMLVideoElement;

export const provider = createHlsProvider(
  videoElement,
  { type: 'hls', src: '/master.m3u8' },
  { loadHls: () => import('hls.js') }
);
