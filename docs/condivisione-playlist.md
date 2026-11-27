# Sharing a playlist as a ZIP

## Exporting

Open a playlist and click **Condividi ZIP** (Share ZIP). ReePlay creates `Documents/MusicApp/content/share/Playlist name.zip` and shows the path in the interface. If a ZIP with the same name exists, ReePlay adds a number and leaves the existing archive intact. You can copy the path and transfer the archive using a USB drive, shared folder, or file transfer service.

The archive contains a folder with `.info`, all the playlist's MP3 files, and its custom cover if present. It uses ZIP_STORED: the ZIP container does not re-encode or recompress the audio. Every extracted MP3 has the same bytes as the playlist file at export time. Quality therefore stays at the level of the original local file; ZIP cannot improve it.

Export is independent of the **Rete Locale** (Local Network) tab. The LAN service supports authorized streaming, while ZIP creates a portable copy. Archives in `content/share/` are not served over the LAN.

## Opening on another PC with ReePlay

1. Transfer the ZIP to the second PC.
2. Extract **the folder inside the ZIP** into `Documents/MusicApp/content/library/` on that PC. For example, you should have `.../content/library/Playlist name/.info` and `.../content/library/Playlist name/01 - Artist - Title.mp3`.
3. Restart ReePlay or reopen **Libreria** (Library) to reload the files. If a folder with the same name already exists on the second PC, rename the new folder before extracting it.

There is currently no **Importa ZIP** (Import ZIP) button; extraction is manual. Do not extract archives from unknown sources into the app's data folder. The extracted MP3 files can also be played in another compatible player; `.info` lets ReePlay recognize the playlist.

## Deletion

**Elimina** (Delete) offers two choices: keep the MP3 files in the Library as individual tracks, or remove the playlist folder and its files. Previously exported ZIPs remain in `content/share/` in both cases and can be removed manually when no longer needed. If a track was copied to another playlist, that copy remains there.
