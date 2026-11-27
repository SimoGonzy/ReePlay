"""File based library. No index or database is persisted."""

import json
import re
import shutil
import threading
import uuid
import zipfile
from pathlib import Path


def safe_name(name: str) -> str:
    value = re.sub(r"[<>:\"/\\|?*\x00-\x1f]", " ", name)
    value = re.sub(r"\s+", " ", value.replace("..", " ")).strip(" .")
    return value[:100] or "Senza titolo"


def _taken(path: Path) -> bool:
    return path.exists() or path.is_symlink()


def _unused_path(folder: Path, name: str, reserved: set[Path] | None = None) -> Path:
    reserved = reserved or set()
    candidate = folder / name
    if not _taken(candidate) and candidate not in reserved:
        return candidate
    stem, suffix = Path(name).stem, Path(name).suffix
    number = 2
    while _taken(folder / f"{stem} ({number}){suffix}") or folder / f"{stem} ({number}){suffix}" in reserved:
        number += 1
    return folder / f"{stem} ({number}){suffix}"


def prepare_content_layout(content: Path) -> tuple[Path, Path]:
    """Move recognized legacy media into content/library without overwriting it."""
    content = Path(content)
    content.mkdir(parents=True, exist_ok=True)
    library, share = content / "library", content / "share"
    for folder in (library, share):
        if folder.is_symlink() or (folder.exists() and not folder.is_dir()):
            raise ValueError(f"Invalid folder: {folder}")
        folder.mkdir(exist_ok=True)
    for item in sorted(content.iterdir(), key=lambda path: path.name.lower()):
        if item in (library, share) or item.is_symlink():
            continue
        is_song = item.is_file() and item.suffix.lower() == ".mp3"
        is_playlist = (item.is_dir() and item.name == safe_name(item.name)
                       and (item / ".info").is_file() and not (item / ".info").is_symlink())
        if is_song or is_playlist:
            item.rename(_unused_path(library, item.name))
    return library, share


class Library:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def create_playlist(self, title: str, spotify_link: str = "") -> Path:
        folder = self.root / safe_name(title)
        if folder.exists():
            suffix = 2
            while (self.root / f"{safe_name(title)} ({suffix})").exists():
                suffix += 1
            folder = self.root / f"{safe_name(title)} ({suffix})"
        folder.mkdir(parents=True, exist_ok=True)
        self.finish_playlist(folder, 0, 0, spotify_link)
        return folder

    def playlist_folder(self, playlist: str) -> Path:
        if playlist != safe_name(playlist) or playlist in ("_singles", ".", ".."):
            raise ValueError("Invalid playlist.")
        folder = self.root / playlist
        if folder.is_symlink() or folder.resolve().parent != self.root.resolve() or (folder / ".info").is_symlink():
            raise ValueError("Invalid playlist.")
        if not (folder / ".info").is_file():
            raise FileNotFoundError("Playlist not found.")
        return folder

    def delete_playlist(self, playlist: str, keep_tracks: bool = True) -> None:
        """Remove a playlist, optionally moving its MP3s to single tracks first."""
        with self._lock:
            folder = self.playlist_folder(playlist)
            if keep_tracks:
                unexpected = [p.name for p in folder.iterdir() if p.name != ".info" and
                              p.name not in ("cover.png", "cover.jpg", "cover.webp") and
                              not (p.is_file() and p.suffix.lower() == ".mp3" and not p.is_symlink())]
                if unexpected:
                    raise ValueError("The playlist contains unsupported files: " + ", ".join(unexpected[:3]))
                reserved: set[Path] = set()
                moves: list[tuple[Path, Path]] = []
                for song in sorted(folder.iterdir(), key=lambda path: (bool(re.search(r" \(\d+\)$", path.stem)), path.name.casefold())):
                    if song.is_file() and song.suffix.lower() == ".mp3":
                        target = _unused_path(self.root, song.name, reserved)
                        reserved.add(target)
                        moves.append((song, target))
                moved: list[tuple[Path, Path]] = []
                try:
                    for source, target in moves:
                        source.rename(target)
                        moved.append((source, target))
                except OSError:
                    for source, target in reversed(moved):
                        target.rename(source)
                    raise
            shutil.rmtree(folder)

    def export_playlist(self, playlist: str, share_root: Path) -> Path:
        """Write an archive without recompressing or changing any MP3 bytes."""
        with self._lock:
            folder = self.playlist_folder(playlist)
            share_root = Path(share_root)
            if share_root.is_symlink():
                raise ValueError("Invalid sharing folder.")
            share_root.mkdir(parents=True, exist_ok=True)
            files = [folder / ".info", *sorted(folder.glob("*.mp3"))]
            files += [folder / name for name in ("cover.png", "cover.jpg", "cover.webp") if (folder / name).is_file()]
            for file in files:
                if file.is_symlink() or not file.resolve().is_relative_to(self.root.resolve()):
                    raise ValueError("The playlist contains an invalid file.")
            archive = _unused_path(share_root, f"{playlist}.zip")
            temporary = share_root / f".{uuid.uuid4().hex}.partial"
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zipped:
                    for file in files:
                        zipped.write(file, arcname=f"{playlist}/{file.name}")
                temporary.rename(archive)
            finally:
                temporary.unlink(missing_ok=True)
            return archive

    def rename_playlist(self, playlist: str, title: str) -> None:
        if not title.strip():
            raise ValueError("Enter a playlist name.")
        folder = self.playlist_folder(playlist)
        info_file = folder / ".info"
        info = json.loads(info_file.read_text(encoding="utf-8"))
        info["titolo"] = title.strip()[:120]
        info_file.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")

    def set_playlist_cover(self, playlist: str, data: bytes) -> None:
        folder = self.playlist_folder(playlist)
        if not data or len(data) > 4 * 1024 * 1024:
            raise ValueError("Choose an image up to 4 MB.")
        if data.startswith(b"\x89PNG\r\n\x1a\n"):
            suffix = ".png"
        elif data.startswith(b"\xff\xd8\xff"):
            suffix = ".jpg"
        elif data.startswith(b"RIFF") and data[8:12] == b"WEBP":
            suffix = ".webp"
        else:
            raise ValueError("PNG, JPEG, and WebP images are supported.")
        target = folder / f"cover{suffix}"
        target.write_bytes(data)
        for old in folder.glob("cover.*"):
            if old != target and old.suffix.lower() in (".png", ".jpg", ".webp"):
                old.unlink()

    def cover_file(self, playlist: str) -> Path:
        folder = self.playlist_folder(playlist)
        for suffix in (".png", ".jpg", ".webp"):
            file = folder / f"cover{suffix}"
            if file.is_file() and not file.is_symlink() and file.resolve().is_relative_to(self.root.resolve()):
                return file
        raise FileNotFoundError("Cover not found.")

    def transfer_track(self, source_playlist: str, filename: str, destination_playlist: str, move: bool) -> None:
        if filename != Path(filename).name or not filename.lower().endswith(".mp3"):
            raise ValueError("Invalid track.")
        if source_playlist == destination_playlist:
            raise ValueError("Choose a different destination.")
        source_folder = self.root if source_playlist == "_singles" else self.playlist_folder(source_playlist)
        destination_folder = self.root if destination_playlist == "_singles" else self.playlist_folder(destination_playlist)
        source = source_folder / filename
        destination = destination_folder / filename
        if not source.is_file():
            raise FileNotFoundError("Track not found.")
        if destination.exists():
            raise FileExistsError("The track is already at the destination.")
        if move:
            shutil.move(source, destination)
        else:
            shutil.copy2(source, destination)
        for folder in {source_folder, destination_folder}:
            if folder != self.root:
                tracks = [self._track(path, folder.name) for path in folder.glob("*.mp3")]
                self.finish_playlist(folder, len(tracks), sum(track["duration"] for track in tracks) / 60)

    def finish_playlist(self, folder: Path, count: int, minutes: float, spotify_link: str | None = None) -> None:
        file = folder / ".info"
        old = json.loads(file.read_text(encoding="utf-8")) if file.exists() else {}
        data = {
            "titolo": old.get("titolo") or folder.name,
            "numero_canzoni": count,
            "lunghezza_minuti": round(minutes, 2),
            "link_spotify": old.get("link_spotify", "") if spotify_link is None else spotify_link,
        }
        file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def list_playlists(self) -> list[dict]:
        result = []
        for folder in sorted(self.root.iterdir(), key=lambda p: p.name.lower()):
            if folder.is_symlink() or not folder.is_dir() or (folder / ".info").is_symlink() or not (folder / ".info").exists():
                continue
            try:
                data = json.loads((folder / ".info").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            data["id"] = folder.name
            data["tracks"] = [self._track(path, folder.name) for path in sorted(folder.glob("*.mp3"))
                              if path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(self.root.resolve())]
            try:
                data["cover_version"] = self.cover_file(folder.name).stat().st_mtime_ns
            except FileNotFoundError:
                data["cover_version"] = None
            result.append(data)
        return result

    def list_singles(self) -> list[dict]:
        return [self._track(path, "") for path in sorted(self.root.glob("*.mp3"))
                if path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(self.root.resolve())]

    def _track(self, path: Path, playlist: str) -> dict:
        title, artist, duration = path.stem, "", 0
        try:
            from mutagen.mp3 import MP3
            audio = MP3(path)
            title = str(audio.get("TIT2", title))
            artist = str(audio.get("TPE1", ""))
            duration = round(audio.info.length)
        except Exception:
            pass
        return {"title": title, "artist": artist, "duration": duration, "file": path.name, "playlist": playlist}
