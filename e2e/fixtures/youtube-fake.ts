import type { Page } from '@playwright/test';

const youtubeDomains = [
  'youtube.com',
  'youtube-nocookie.com',
  'youtu.be',
  'ytimg.com',
  'googlevideo.com',
  'ggpht.com'
];

export const isYouTubeUrl = (url: URL): boolean =>
  youtubeDomains.some(
    (domain) => url.hostname === domain || url.hostname.endsWith(`.${domain}`)
  );

// A deterministic stand-in for https://www.youtube.com/iframe_api. It mirrors
// the parts of the real API the adapter relies on: the window-level ready
// callback, the adoption of the iframe it is handed rather than one it builds,
// and asynchronous state confirmation.
//
// It also mirrors the platform's own natural end (#854): while playing,
// `currentTime` advances at real wall-clock speed, and on reaching
// `getDuration()` the fake fires the platform's own ENDED, exactly as a real
// embed does. What happens after that ENDED depends on whether a `start`
// player var is on the url, the same way it does for the real embed
// (`boundary.ts`'s `restartsAtStart`): with one (`start=`,
// `ViewportAutoplayScrollLoopMutedYoutube`), the ENDED reaches the adapter's
// own `restartFromBoundary`, whose seek back to `startTime` and resulting
// `playVideo()` call are this fake's ordinary command handling, not a
// shortcut it takes for itself; with none
// (`ViewportAutoplayScrollLoopMutedYoutubeNoBoundary`), nothing in the
// adapter ever calls `playVideo` again, so the fake fires the platform's own
// PLAYING on its own, the same way YouTube's single-video-playlist loop
// restarts an embed with no `start` configured. A short `getDuration()` for
// a `loop=1` src keeps that real-clock wait to a fraction of a second rather
// than the 120s every other fixture in this file gets, which none of them
// read.
export const fakeIframeApi = `
  window.YT = {
    PlayerState: {
      UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5
    },
    Player: function (iframe, config) {
      let state = -1;
      let currentTime = 0;
      const target = {};
      const events = config.events || {};
      const setState = (next) => {
        state = next;
        if (events.onStateChange) events.onStateChange({ data: next, target });
      };
      const looping = /[?&]loop=1(?:&|$)/.test(iframe.src);
      const hasStartBoundary = /[?&]start=\\d/.test(iframe.src);
      const duration = looping ? 1 : 120;
      // Captions module (#858): a fixed two-language tracklist, and the
      // reported current track. \`loadModule('captions')\` is what
      // \`attachment.ts\`'s onReady calls unconditionally, mirroring the
      // observed bug this fixture exists to falsify -- a track already
      // selected with no command from the adapter -- whenever the embed's
      // own \`cc_load_policy=0\` var (the fix) is absent from \`iframe.src\`.
      // This fake HONOURS \`cc_load_policy=0\` by construction, below -- it is
      // this file's own stand-in for the real behaviour, not a fact about the
      // real embed. \`attachment.ts\`'s own comment on the var is explicit that
      // this is UNVERIFIED against a real player: the docs give \`cc_load_policy=0\`
      // no meaning beyond the var's own absence, so what this fake simulates
      // is the intended effect, not a measured one.
      const captionsTracklist = [
        { languageCode: 'en', displayName: 'English' },
        { languageCode: 'es', displayName: 'Spanish' }
      ];
      const ccLoadPolicyOff = /[?&]cc_load_policy=0(?:&|$)/.test(iframe.src);
      let captionsTrack = {};
      let clockTimer;
      let lastTick;
      const stopClock = () => {
        clearInterval(clockTimer);
        clockTimer = undefined;
      };
      const startClock = () => {
        if (clockTimer) return;
        lastTick = Date.now();
        clockTimer = setInterval(() => {
          const now = Date.now();
          currentTime += (now - lastTick) / 1000;
          lastTick = now;
          if (currentTime < duration) return;
          currentTime = duration;
          stopClock();
          setState(0);
          if (looping && !hasStartBoundary) {
            setTimeout(() => {
              currentTime = 0;
              setState(1);
              startClock();
            }, 0);
          }
        }, 50);
      };
      Object.assign(target, {
        playVideo: () =>
          setTimeout(() => {
            setState(1);
            startClock();
          }, 0),
        pauseVideo: () => {
          stopClock();
          setTimeout(() => setState(2), 0);
        },
        seekTo: (seconds) => {
          currentTime = seconds;
        },
        mute: () => {},
        unMute: () => {},
        isMuted: () => false,
        setVolume: () => {},
        getVolume: () => 100,
        getDuration: () => duration,
        getVideoLoadedFraction: () => 1,
        getCurrentTime: () => currentTime,
        getPlaybackRate: () => 1,
        setPlaybackRate: () => {},
        getPlayerState: () => state,
        getIframe: () => iframe,
        loadModule: (module) => {
          if (module !== 'captions') return;
          setTimeout(() => {
            if (!ccLoadPolicyOff) captionsTrack = { languageCode: 'en' };
            if (events.onApiChange) events.onApiChange({ target });
          }, 0);
        },
        unloadModule: () => {},
        getOption: (module, option) => {
          if (module !== 'captions') return undefined;
          if (option === 'tracklist') return captionsTracklist;
          if (option === 'track') return captionsTrack;
          return undefined;
        },
        setOption: (module, option, value) => {
          if (module === 'captions' && option === 'track') {
            captionsTrack = value;
          }
        },
        destroy: () => {
          stopClock();
          iframe.remove();
        }
      });
      setTimeout(() => {
        if (events.onReady) events.onReady({ target });
      }, 0);
      return target;
    }
  };
  if (window.onYouTubeIframeAPIReady) window.onYouTubeIframeAPIReady();
`;

export const routeYouTube = async (page: Page): Promise<string[]> => {
  const requests: string[] = [];
  await page.route(isYouTubeUrl, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.href);
    if (url.pathname === '/iframe_api') {
      await route.fulfill({
        body: fakeIframeApi,
        contentType: 'text/javascript',
        status: 200
      });
      return;
    }
    if (url.pathname.startsWith('/embed/')) {
      await route.fulfill({
        body: '<!doctype html><title>embed</title>',
        contentType: 'text/html',
        status: 200
      });
      return;
    }
    await route.fulfill({ body: '', status: 204 });
  });
  return requests;
};
