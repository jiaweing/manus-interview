import { Composition } from "remotion";
import { PrimitivesGallery } from "./PrimitivesGallery.jsx";

export const GalleryRoot = () => <Composition id="PrimitivesGallery" component={PrimitivesGallery}
  width={1920} height={1080} fps={30} durationInFrames={240} />;
