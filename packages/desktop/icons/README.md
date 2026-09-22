# App icons

One drawing per channel in `master/` (`prod.svg` charcoal, `beta.svg` light, `dev.svg`
blue — the tile colour is how you tell which build is in the dock). Every file in a
channel folder is rasterised from its master; edit the SVG, never the PNGs.

The glyph is the block-alphabet `c` from `packages/ui/src/components/logo.tsx`
(24×30 on a stroke of 6), drawn 440px tall on a 1024 canvas and nudged 12px right to
sit on the optical centre. The tile is an 824px continuous-corner square inset in that
canvas, which is Apple's icon grid.

Two crops come out of each master:

- **macOS** (`icon.icns`, `dock.png`) keeps the full 1024 canvas — the ~10% transparent
  margin and soft shadow are what make the icon sit at the same size as its neighbours
  in the Dock. `dock.png` is the 256px layer, used by `app.dock.setIcon()` in unpackaged
  runs so dev matches the packaged inset.
- **everything else** (`icon.png`, `icon.ico`, the Linux `NxN.png` set, the Windows
  `Square*Logo` tiles) crops to the tile bounds `(100,100)–(924,924)` so it runs edge to
  edge, which those platforms expect.

To regenerate: rasterise each master at 1024×1024 on a transparent background (headless
Chrome does this faithfully — `--default-background-color=00000000`), then resize with a
Lanczos filter to each size above, build the `.iconset` (16/32/128/256/512 plus `@2x`)
and run `iconutil -c icns`, and write the `.ico` with the 16–256 sizes. Pillow handles the
resizes and the `.ico`.

`android/` and `ios/` are Tauri-era leftovers nothing in the Electron build reads; they
have not been regenerated.

`resources/icons` is a build output: `scripts/copy-icons.ts` copies the channel folder
there on `predev`/`prebuild`, so changes must land here, not in `resources/`.
