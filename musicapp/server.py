"""Loopback HTTP API and built frontend."""

import os
import shutil
from pathlib import Path
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from .pipeline import ImportManager
from .network import ConnectRequest, InspectRequest, NetworkManager
from .storage import Library, prepare_content_layout, safe_name
from .themes import load_plugin_themes


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_ROOT = Path(os.environ.get("MUSICAPP_DATA_DIR", PROJECT_ROOT))
LIBRARY_ROOT, SHARE_ROOT = prepare_content_layout(DATA_ROOT / "content")
library = Library(LIBRARY_ROOT)
imports = ImportManager(library)
network = NetworkManager(library, DATA_ROOT / "config" / "network")
app = FastAPI(title="ReePlay", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "tauri://localhost", "http://tauri.localhost",
        "http://127.0.0.1:5173", "http://localhost:5173",
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["content-type"],
)


@app.middleware("http")
async def local_api_guard(request: Request, call_next):
    """Keep websites and DNS rebinding from controlling the loopback API."""
    host = request.headers.get("host", "").split(":", 1)[0].lower()
    origin = request.headers.get("origin")
    allowed_origins = {"tauri://localhost", "http://tauri.localhost", "http://127.0.0.1:5173", "http://localhost:5173"}
    if (request.client and request.client.host not in {"127.0.0.1", "::1"}) or host not in {"127.0.0.1", "localhost"} or (origin and origin not in allowed_origins):
        return Response(status_code=403)
    return await call_next(request)


class LinkRequest(BaseModel):
    url: str


class NameRequest(BaseModel):
    title: str


class AddRequest(BaseModel):
    file: str
    playlist: str


class TransferRequest(BaseModel):
    source: str
    file: str
    destination: str
    move: bool = True


@app.get("/api/network/status")
def network_status():
    return network.status()


@app.post("/api/network/start")
def network_start():
    try:
        return network.start()
    except OSError as exc:
        raise HTTPException(503, f"Could not start sharing: {exc}")


@app.post("/api/network/stop")
def network_stop():
    return network.stop()


@app.put("/api/network/name")
def network_name(request: NameRequest):
    try:
        return network.set_name(request.title)
    except ValueError as exc:
        raise HTTPException(400, str(exc))


@app.post("/api/network/code")
def network_code():
    try:
        return network.new_code()
    except ValueError as exc:
        raise HTTPException(409, str(exc))


@app.delete("/api/network/clients/{client_id}")
def network_revoke(client_id: str):
    try:
        network.revoke(client_id)
    except KeyError:
        raise HTTPException(404, "Device not found.")
    return network.status()


@app.delete("/api/network/peers/{peer_id}")
def network_forget(peer_id: str):
    try:
        network.forget(peer_id)
    except KeyError:
        raise HTTPException(404, "Computer not found.")
    return network.status()


@app.get("/api/network/discover")
def network_discover():
    try:
        return {"devices": network.discover()}
    except OSError as exc:
        raise HTTPException(503, f"Network discovery unavailable: {exc}")


@app.post("/api/network/inspect")
def network_inspect(body: InspectRequest):
    try:
        return network.inspect(body.host, body.port)
    except (ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(502, str(exc))


@app.post("/api/network/connect")
def network_connect(body: ConnectRequest):
    try:
        return network.connect(body.host, body.port, body.fingerprint, body.code)
    except (ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(502, str(exc))


@app.get("/api/network/peers/{peer_id}/library")
def network_library(peer_id: str):
    try:
        return network.remote_library(peer_id)
    except KeyError:
        raise HTTPException(404, "Computer not found.")
    except PermissionError as exc:
        raise HTTPException(401, str(exc))
    except (ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(502, str(exc))


def _network_proxy(peer_id: str, kind: str, playlist: str, filename: str | None = None, range_header: str | None = None):
    try:
        return network.proxy(peer_id, kind, playlist, filename, range_header)
    except KeyError:
        raise HTTPException(404, "Computer not found.")
    except (ValueError, OSError, TimeoutError) as exc:
        raise HTTPException(502, str(exc))


@app.get("/api/network/peers/{peer_id}/media/{playlist}/{filename}")
def network_media(peer_id: str, playlist: str, filename: str, request: Request):
    return _network_proxy(peer_id, "media", playlist, filename, request.headers.get("range"))


@app.get("/api/network/peers/{peer_id}/art/{playlist}/{filename}")
def network_art(peer_id: str, playlist: str, filename: str):
    return _network_proxy(peer_id, "art", playlist, filename)


@app.get("/api/network/peers/{peer_id}/cover/{playlist}")
def network_cover(peer_id: str, playlist: str):
    return _network_proxy(peer_id, "cover", playlist)


@app.get("/api/status")
def status():
    return {"ffmpeg": bool(shutil.which("ffmpeg") and shutil.which("ffprobe")), "content": str(library.root)}


@app.get("/api/library")
def list_library():
    return {"playlists": library.list_playlists(), "singles": library.list_singles()}


@app.get("/api/themes")
def themes():
    return {"plugins": load_plugin_themes(DATA_ROOT / "themes" / "plugins")}


@app.post("/api/playlists")
def new_playlist(request: NameRequest):
    if not request.title.strip():
        raise HTTPException(400, "Enter a playlist name.")
    folder = library.create_playlist(request.title)
    return {"id": folder.name}


@app.post("/api/playlists/add")
def add_to_playlist(request: AddRequest):
    if request.file != Path(request.file).name or request.playlist != safe_name(request.playlist):
        raise HTTPException(400, "Invalid path.")
    source = library.root / request.file
    target_dir = library.root / request.playlist
    if not source.is_file() or not (target_dir / ".info").is_file():
        raise HTTPException(404, "Track or playlist not found.")
    target = target_dir / source.name
    if target.exists():
        raise HTTPException(409, "The track is already in the playlist.")
    shutil.copy2(source, target)
    tracks = library.list_playlists()
    playlist = next(item for item in tracks if item["id"] == request.playlist)
    library.finish_playlist(target_dir, len(playlist["tracks"]), sum(t["duration"] for t in playlist["tracks"]) / 60)
    return {"ok": True}


@app.put("/api/playlists/{playlist}")
def rename_playlist(playlist: str, request: NameRequest):
    try:
        library.rename_playlist(playlist, request.title)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return {"ok": True}


@app.delete("/api/playlists/{playlist}")
def delete_playlist(playlist: str, keep_tracks: bool = True):
    if imports.is_downloading_playlist(playlist):
        raise HTTPException(409, "Wait for this playlist's download to finish.")
    try:
        library.delete_playlist(playlist, keep_tracks=keep_tracks)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return {"ok": True}


@app.post("/api/playlists/{playlist}/export")
def export_playlist(playlist: str):
    if imports.is_downloading_playlist(playlist):
        raise HTTPException(409, "Wait for this playlist's download to finish.")
    try:
        archive = library.export_playlist(playlist, SHARE_ROOT)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return {"name": archive.name, "path": str(archive), "size": archive.stat().st_size}


@app.put("/api/playlists/{playlist}/cover")
async def set_playlist_cover(playlist: str, request: Request):
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 4 * 1024 * 1024:
            raise HTTPException(413, "Choose an image up to 4 MB.")
    try:
        library.set_playlist_cover(playlist, bytes(data))
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return {"ok": True}


@app.get("/api/playlists/{playlist}/cover")
def playlist_cover(playlist: str):
    try:
        file = library.cover_file(playlist)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    return FileResponse(file, media_type={".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[file.suffix.lower()], headers={"X-Content-Type-Options": "nosniff"})


@app.post("/api/tracks/transfer")
def transfer_track(request: TransferRequest):
    try:
        library.transfer_track(request.source, request.file, request.destination, request.move)
    except ValueError as exc:
        raise HTTPException(400, str(exc))
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))
    except FileExistsError as exc:
        raise HTTPException(409, str(exc))
    return {"ok": True}


@app.post("/api/preview")
def preview(request: LinkRequest):
    return imports.queue_preview(request.url)


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str):
    try:
        return imports.get(job_id)
    except KeyError:
        raise HTTPException(404, "Import job not found.")


@app.get("/api/jobs")
def list_jobs():
    return {"jobs": imports.list_jobs()}


@app.post("/api/jobs/{job_id}/download")
def start_download(job_id: str):
    try:
        return imports.start(job_id)
    except KeyError:
        raise HTTPException(404, "Import job not found.")
    except ValueError as exc:
        raise HTTPException(409, str(exc))


def _media_path(playlist: str, filename: str) -> Path:
    filename = unquote(filename)
    playlist = unquote(playlist)
    if filename != Path(filename).name or playlist not in ("_singles", safe_name(playlist)):
        raise HTTPException(400, "Invalid path.")
    try:
        folder = library.root if playlist == "_singles" else library.playlist_folder(playlist)
    except (ValueError, FileNotFoundError):
        raise HTTPException(404, "Track not found.")
    file = folder / filename
    if file.suffix.lower() != ".mp3" or not file.is_file() or file.is_symlink() or not file.resolve().is_relative_to(library.root.resolve()):
        raise HTTPException(404, "Track not found.")
    return file


@app.get("/api/media/{playlist}/{filename}")
def media(playlist: str, filename: str):
    return FileResponse(_media_path(playlist, filename), media_type="audio/mpeg")


@app.get("/api/art/{playlist}/{filename}")
def art(playlist: str, filename: str):
    try:
        from mutagen.id3 import ID3
        frames = ID3(_media_path(playlist, filename)).getall("APIC")
        if frames:
            return Response(frames[0].data, media_type=frames[0].mime)
    except HTTPException:
        raise
    except Exception:
        pass
    raise HTTPException(404, "Cover not found.")
