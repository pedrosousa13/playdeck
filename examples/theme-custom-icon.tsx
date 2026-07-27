import * as Player from '@reely/react';
import type { ReactElement } from 'react';

declare const MyPlayIcon: () => ReactElement;

// Every control renders a default icon and accepts children instead. The theme
// sizes whatever `svg` it finds via `--reely-control-icon-size`, so this works
// with or without the stylesheet — and the control keeps its own accessible
// name either way.
export const CustomIconButton = () => (
  <Player.PlayButton>
    <MyPlayIcon />
  </Player.PlayButton>
);
