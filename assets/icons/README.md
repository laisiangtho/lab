# Linux icon set

The sizes the hicolor icon theme defines, generated from `assets/icon.png`
(1024 × 1024). `electron-builder.yml` installs this folder as the Linux icon,
and `targets/desktop/electron/window.js` uses `256x256.png` as the window icon.

After `assets/icon.png` changes, regenerate every size, for example with
ImageMagick:

```sh
for n in 16 24 32 48 64 128 256 512; do
  magick assets/icon.png -resize ${n}x${n} assets/icons/${n}x${n}.png
done
```
