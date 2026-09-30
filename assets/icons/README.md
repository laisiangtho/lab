# Icons

Every PNG the builds ship is drawn from one source, `public/icons/icon.svg`:

| File | Size | Used by |
|---|---|---|
| `assets/icon.png` | 1024 | electron-builder, macOS and Windows |
| `assets/icons/NxN.png` | 16–512 | the Linux hicolor theme (`linux.icon`), `256x256.png` as the window icon |
| `public/icons/favicon-32.png` | 32 | the web build's fallback favicon |
| `public/icons/icon-192.png`, `icon-512.png` | 192, 512 | the web manifest |
| `public/icons/icon-maskable-512.png` | 512 | the manifest's maskable icon: 80 % of the icon on the app background, inside Android's safe zone |

After `icon.svg` changes:

```sh
npm run icons              # dry run: what would be written
npm run icons -- --apply   # draw them, and record the SVG's fingerprint
npm run icons -- --out DIR # draw them somewhere else, to look at first
```

The drawing is done by the Chromium the browser tests use (playwright-core),
so no image library is needed. `source.sha256` is the fingerprint of the SVG
the PNGs were drawn from; `test/icons.test.js` fails when the SVG has changed
and the PNGs were not drawn again.

The PNGs are committed rather than drawn during a build: a build would then
need a browser on every release runner, and two Chromium versions do not draw
identical pixels, so every build would report icons changed that nobody
changed.
