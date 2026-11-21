import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { FONT_NAME, FONT_WEIGHTS, fontFaceCss } from "./fonts.js";

// One loader per SceneFrame; fonts are local public assets and browser-cached.
export const FontLoader = () => {
  const [handle] = useState(() => delayRender("Load bundled Inter 400/600/700"));
  useEffect(() => {
    let mounted = true;
    Promise.all(FONT_WEIGHTS.map(async (weight) => {
      const faces = await document.fonts.load(`${weight} 60px "${FONT_NAME}"`);
      if (faces.length === 0) throw new Error(`Bundled Inter ${weight} did not load`);
    })).then(() => {
      if (mounted) continueRender(handle);
    }).catch((error) => cancelRender(error));
    return () => { mounted = false; };
  }, [handle]);
  return <style>{fontFaceCss()}</style>;
};
