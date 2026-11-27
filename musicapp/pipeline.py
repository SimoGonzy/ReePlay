"""Preview, match and download imports on the local machine."""

import shutil
import ssl
import re
import threading
import uuid
from pathlib import Path

from .sources import fetch_spotify, parse_source_url
from .storage import Library, safe_name


def yt_dlp_options(**options) -> dict:
    """Enable the JavaScript runtimes supported by this app's yt-dlp calls."""
    return {"js_runtimes": {"deno": {}, "node": {}}, **options}


def resolve_link(url: str) -> dict:
    kind, source_id = parse_source_url(url)
    if kind.startswith("spotify_"):
        result = fetch_spotify(kind.split("_", 1)[1], source_id)
        result["link_spotify"] = url
        result["is_playlist"] = kind == "spotify_playlist"
        return result
    from yt_dlp import YoutubeDL
    with YoutubeDL(yt_dlp_options(quiet=True, extract_flat="in_playlist", skip_download=True, noplaylist=kind == "youtube_track")) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise ValueError("YouTube non ha restituito dati per il link.")
    entries = info.get("entries") or [info]
    tracks = []
    for entry in entries:
        if not entry:
            continue
        video_id = entry.get("id") or entry.get("url")
        if not video_id:
            continue
        tracks.append({"title": entry.get("title") or "Senza titolo", "artist": entry.get("uploader") or entry.get("channel") or "", "duration": entry.get("duration") or 0, "cover": entry.get("thumbnail") or "", "direct_url": f"https://www.youtube.com/watch?v={video_id}"})
    if not tracks:
        raise ValueError("Nessun brano trovato nel link YouTube.")
    return {"title": info.get("title") or tracks[0]["title"], "tracks": tracks, "link_spotify": "", "is_playlist": kind == "youtube_playlist"}


def search_youtube(track: dict) -> dict | None:
    if track.get("direct_url"):
        return {"url": track["direct_url"], "duration": track.get("duration") or 0, "size": None}
    from yt_dlp import YoutubeDL
    query = " ".join(part for part in (track.get("artist", ""), track["title"], "audio") if part)
    with YoutubeDL(yt_dlp_options(quiet=True, skip_download=True, extract_flat=True, ignoreerrors=True)) as ydl:
        results = ydl.extract_info(f"ytsearch5:{query}", download=False)
    entries = (results or {}).get("entries") or []
    best = choose_candidate(track, entries)
    if not best:
        return None
    return {"url": f"https://www.youtube.com/watch?v={best['id']}", "duration": best.get("duration") or 0, "size": best.get("filesize") or best.get("filesize_approx"), "title": best.get("title") or ""}


def choose_candidate(track: dict, entries: list[dict]) -> dict | None:
    title_words = set(re.findall(r"[^\W_]+", track["title"].casefold()))
    artist_words = set(re.findall(r"[^\W_]+", track.get("artist", "").casefold()))
    ranked = []
    for item in entries:
        if not item or not item.get("id"):
            continue
        found_title = (item.get("title") or "").casefold()
        found_words = set(re.findall(r"[^\W_]+", found_title + " " + (item.get("uploader") or "").casefold()))
        if not title_words or len(title_words & found_words) / len(title_words) < .6:
            continue
        if artist_words and len(artist_words & found_words) / len(artist_words) < .5:
            continue
        duration = item.get("duration") or 0
        expected = track.get("duration") or 0
        if expected and duration and abs(duration - expected) > max(35, expected * .3):
            continue
        score = 3 * len(title_words & found_words) + 2 * len(artist_words & found_words)
        if expected and duration:
            score -= abs(duration - expected) / 15
        if any(word in found_title for word in ("cover", "karaoke", "reaction", "live", "remix")):
            score -= 3
        ranked.append((score, item))
    return max(ranked, key=lambda pair: pair[0])[1] if ranked else None


def download_audio(track: dict, candidate: dict, destination: Path, progress) -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise RuntimeError("FFmpeg e FFprobe non trovati. Installali e riavvia ReePlay.")
    from yt_dlp import YoutubeDL
    destination.parent.mkdir(parents=True, exist_ok=True)
    def hook(data):
        if data.get("status") == "downloading":
            progress({"bytes": data.get("downloaded_bytes") or 0, "total_bytes": data.get("total_bytes") or data.get("total_bytes_estimate"), "eta_seconds": data.get("eta")})
    options = yt_dlp_options(
        format="bestaudio/best", outtmpl=str(destination.with_suffix(".%(ext)s")),
        quiet=True, noplaylist=True, progress_hooks=[hook],
        # Quality 0 is yt-dlp/FFmpeg's highest VBR MP3 setting; it does not improve the source audio.
        postprocessors=[{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "0"}],
        overwrites=False,
    )
    with YoutubeDL(options) as ydl:
        ydl.download([candidate["url"]])
    if not destination.exists():
        raise RuntimeError("Il file audio convertito non è stato creato.")
    try:
        from mutagen.id3 import APIC, ID3, TALB, TIT2, TPE1
        tags = ID3(destination)
        tags.delall("TIT2"); tags.add(TIT2(encoding=3, text=track["title"]))
        if track.get("artist"):
            tags.delall("TPE1"); tags.add(TPE1(encoding=3, text=track["artist"]))
        if track.get("album"):
            tags.delall("TALB"); tags.add(TALB(encoding=3, text=track["album"]))
        cover = track.get("cover")
        if cover and cover.startswith("https://"):
            import certifi
            from urllib.request import Request, urlopen
            with urlopen(Request(cover, headers={"User-Agent": "Mozilla/5.0"}), timeout=10, context=ssl.create_default_context(cafile=certifi.where())) as response:
                picture = response.read(3_000_000)
                mime = response.headers.get_content_type()
            if mime.startswith("image/"):
                tags.delall("APIC"); tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=picture))
        tags.save(destination)
    except Exception:
        # A valid audio file is preferable to dropping the song if art/tagging fails.
        pass


class ImportManager:
    def __init__(self, library: Library, resolve=resolve_link, search=search_youtube, download=download_audio):
        self.library = library
        self.resolve = resolve
        self.search = search
        self.download = download
        self.jobs: dict[str, dict] = {}
        self.lock = threading.RLock()

    def get(self, job_id: str) -> dict:
        with self.lock:
            if job_id not in self.jobs:
                raise KeyError(job_id)
            job = self.jobs[job_id]
            return {key: value for key, value in job.items() if not key.startswith("_")}

    def is_downloading_playlist(self, playlist: str) -> bool:
        with self.lock:
            return any(job.get("state") == "downloading" and job.get("_folder") == playlist
                       for job in self.jobs.values())

    def list_jobs(self) -> list[dict]:
        with self.lock:
            return [self.get(job_id) for job_id in reversed(self.jobs)]

    def queue_preview(self, url: str) -> dict:
        job_id = uuid.uuid4().hex
        self.jobs[job_id] = {"id": job_id, "state": "searching", "title": "", "total": 0, "searched": 0, "found": 0, "missing": [], "downloaded": 0, "failed": [], "progress": {}}
        threading.Thread(target=self._prepare, args=(job_id, url), daemon=True).start()
        return self.get(job_id)

    def preview(self, url: str) -> dict:
        job_id = uuid.uuid4().hex
        self.jobs[job_id] = {"id": job_id, "state": "searching", "title": "", "total": 0, "searched": 0, "found": 0, "missing": [], "downloaded": 0, "failed": [], "progress": {}}
        self._prepare(job_id, url)
        return self.get(job_id)

    def _prepare(self, job_id: str, url: str) -> None:
        job = self.jobs[job_id]
        try:
            source = self.resolve(url)
            job["title"] = source["title"]
            job["total"] = len(source["tracks"])
            job["is_playlist"] = source.get("is_playlist", len(source["tracks"]) > 1)
            job["link_spotify"] = source.get("link_spotify", "")
            job["_tracks"] = []
            for track in source["tracks"]:
                label = f"{track.get('artist', '')} — {track['title']}".strip(" —")
                try:
                    candidate = self.search(track)
                except Exception:
                    candidate = None
                job["_tracks"].append((track, candidate))
                if candidate:
                    job["found"] += 1
                else:
                    job["missing"].append(label)
                job["searched"] += 1
            job["estimated_bytes"] = sum(candidate.get("size") or 0 for _, candidate in job["_tracks"] if candidate) or None
            job["state"] = "ready"
        except Exception as exc:
            job["state"] = "error"
            job["error"] = str(exc)

    def start(self, job_id: str) -> dict:
        job = self.jobs[job_id]
        if job["state"] != "ready":
            raise ValueError("L'anteprima non è pronta.")
        job["state"] = "downloading"
        threading.Thread(target=self.run_download, args=(job_id,), daemon=True).start()
        return self.get(job_id)

    def run_download(self, job_id: str) -> None:
        job = self.jobs[job_id]
        if job["state"] not in ("ready", "downloading"):
            raise ValueError("L'anteprima non è pronta.")
        job["state"] = "downloading"
        folder = self.library.create_playlist(job["title"], job.get("link_spotify", "")) if job["is_playlist"] else self.library.root
        if job["is_playlist"]:
            job["_folder"] = folder.name
        minutes = 0.0
        for index, (track, candidate) in enumerate(job["_tracks"], start=1):
            if not candidate:
                continue
            label = f"{track.get('artist', '')} — {track['title']}".strip(" —")
            file_title = f"{index:02d} - {track.get('artist', '')} - {track['title']}" if job["is_playlist"] else track["title"]
            destination = folder / f"{safe_name(file_title)}.mp3"
            job["current"] = label
            job["progress"] = {}
            try:
                self.download(track, candidate, destination, lambda value: job.update(progress=value))
                job["downloaded"] += 1
                minutes += (track.get("duration") or candidate.get("duration") or 0) / 60
            except Exception as exc:
                job["failed"].append(f"{label}: {exc}")
        if job["is_playlist"]:
            self.library.finish_playlist(folder, job["downloaded"], minutes)
        job["progress"] = {}
        job["state"] = "done"
