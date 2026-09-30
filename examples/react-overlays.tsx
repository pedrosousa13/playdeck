import * as Player from '@playdeck/react';

// The overlay layers, in the order they stack inside a Viewport. Each renders
// only when its own state says it should: no disabled-looking placeholders,
// with one exception noted below.
export const Overlays = () => (
  <Player.Viewport>
    <Player.Poster>
      <Player.PosterImage alt="" src="/poster.jpg" />
    </Player.Poster>
    <Player.Media />
    {/* Deferred loading: the button activates the player on first interaction. */}
    <Player.ActivationButton aria-label="Play" />
    <Player.LoadingIndicator />
    <Player.Captions />
    {/* Renders only on a live source -- nothing while `state.live` is null.
        The one exception to "no disabled-looking placeholders" above: where
        the provider cannot seek to the live edge it stays mounted as a
        disabled badge, because being live is true whether or not that
        command exists. Where the provider can, it is an active button. */}
    <Player.LiveIndicator />
    <Player.Gestures
      seekOffset={10}
      onSeek={(direction, offset) => console.log(direction, offset)}
    />
    {/* `retry` is null when the error cannot be retried — absent, not
        disabled. */}
    <Player.ErrorDisplay>
      {({ error, retry }) => (
        <div role="alert">
          {error.message}
          {retry ? <button onClick={retry}>Retry</button> : null}
        </div>
      )}
    </Player.ErrorDisplay>
  </Player.Viewport>
);

// `Poster` accepts a URL string, an image-props object, or your own element.
// `normalizePoster` is the same resolution the primitive performs.
export const poster = Player.normalizePoster('/poster.jpg');
