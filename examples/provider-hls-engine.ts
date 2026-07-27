import {
  createHlsProvider,
  detectHlsEnvironment,
  selectHlsEngine
} from '@reely/provider-hls';

declare const videoElement: HTMLVideoElement;

// What this browser offers, asked before anything is loaded.
const environment = detectHlsEnvironment(videoElement); // { nativeHls, mse }

// Forcing an engine the browser cannot provide fails with an explained error
// rather than silently falling back to the other one.
const selection = selectHlsEngine('hls.js', environment);
if (selection.engine === null) throw new Error(selection.error.message);

export const engine = selection.engine; // 'native' | 'hls.js'

export const provider = createHlsProvider(videoElement, {
  type: 'hls',
  src: '/master.m3u8',
  engine: 'hls.js'
});
