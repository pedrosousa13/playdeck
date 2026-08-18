import * as Player from '@playdeck/react';
import type { ReactElement } from 'react';

declare const MyPlayIcon: () => ReactElement;

// Every control accepts children instead of its default. The theme sizes
// whatever `svg` it finds via `--playdeck-control-icon-size`, so this works
// with or without the stylesheet — and the control keeps its own accessible
// name either way.
export const CustomIconButton = () => (
  <Player.PlayButton>
    <MyPlayIcon />
  </Player.PlayButton>
);
