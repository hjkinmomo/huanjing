# Hermes role card

The renderer adapts RuiC's registered layer shaders and actual Blender-exported geometry. The artwork, profiles and bundle are local; no CDN, remote fonts, model credentials or dialogue are needed.

`viewer-source.js` owns the same-origin iframe bridge and renderer lifecycle. `shaders.js` contains the RuiC shader source, credited in `LICENSE-RuiC.txt`. Three.js is credited in `LICENSE-Three.txt`. The runtime uses `viewer.js`, so installing the build dependencies is unnecessary for opening Hermes.

To rebuild this standalone asset bundle, run `npm install` and `npm run build` in this directory. Rebuild the chat React bundle from the existing frontend project separately. Keep role-specific assets registered on the same canvas; never reuse a character's lineart for a different uploaded portrait.

The bridge accepts messages only from the same-origin parent window. Updates contain public role id, name, selected portrait and finish. Environment messages pause hidden cards, synchronize theme and framing, and honor both the application preference and the OS reduced-motion setting. Card controls never write dialogue or prompt data.

The original three editable Blender projects, with packed image layers, are in `docs/reviews/card-motion-20261005/editable-cards`. WebGL material rendering approximates Blender's shader appearance; the CSS fallback provides a lighter interactive card without those shaders.
