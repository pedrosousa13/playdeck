import {
  Controls,
  createElement,
  createRoot,
  FullscreenButton,
  Media,
  PlayButton,
  Root,
  SeekSlider,
  Time,
  Viewport
} from '@playdeck/react/browser';

// `createElement` in place of JSX -- a page with nothing but a `<script>` tag
// has no compiler to turn JSX into this for it. Only `Media` and native
// sources work through this entry; see the paragraph above for why.
const player = createElement(Root, {
  source: 'https://example.com/clip.mp4',
  children: createElement(
    Viewport,
    null,
    createElement(Media, null),
    createElement(
      Controls,
      null,
      createElement(PlayButton, null),
      createElement(SeekSlider, null),
      createElement(Time, { type: 'current' }),
      createElement(FullscreenButton, null)
    )
  )
});

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from the page');
createRoot(container).render(player);
