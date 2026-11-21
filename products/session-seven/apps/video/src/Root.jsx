import { Composition } from "remotion";
import { Hero } from "./Hero.jsx";
import { FILM } from "./film-config.js";

export const RemotionRoot = () => (
  <Composition
    id={FILM.compositionId}
    component={Hero}
    width={FILM.width}
    height={FILM.height}
    fps={FILM.fps}
    durationInFrames={FILM.durationInFrames}
  />
);
