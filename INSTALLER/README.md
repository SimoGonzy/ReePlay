# ReePlay installers

In the local working copy, this folder contains packages ready to install:

- `Windows/ReePlay_0.4.3_x64-setup.exe`
- `Linux/ReePlay_0.4.3_amd64.deb`
- `Linux/ReePlay_0.4.3_amd64.AppImage`
- `Linux/install-appimage.sh` and `Linux/ReePlay.png`, which add the AppImage to the application menu.

The installers exceed Git's ordinary 100 MiB file size limit and are excluded by `.gitignore`. **When publishing the source, upload the three packages as assets of a [GitHub Release](https://github.com/SimoGonzy/ReePlay/releases)**, together with `SHA256SUMS.txt` so downloads can be verified. A Git checkout contains this guide and the small Linux integration files; download the binaries from the Release.

To rebuild the packages, use the scripts at the project root described in the [main README](../README.md#building-from-source). Do not force-add the installers with `git add -f`: GitHub would reject files above the limit.
