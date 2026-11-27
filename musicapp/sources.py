"""Read supported public link metadata."""

import json
import re
import ssl
import certifi
from html import unescape
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


NEXT_DATA = re.compile(r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>', re.I | re.S)


def parse_source_url(url: str) -> tuple[str, str]:
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    parts = [part for part in parsed.path.split("/") if part]
    if host == "open.spotify.com":
        if parts and parts[0].startswith("intl-"):
            parts = parts[1:]
        if len(parts) >= 2 and parts[0] in ("playlist", "track") and re.fullmatch(r"[A-Za-z0-9]+", parts[1]):
            return f"spotify_{parts[0]}", parts[1]
    if host in ("www.youtube.com", "youtube.com", "music.youtube.com"):
        from urllib.parse import parse_qs
        query = parse_qs(parsed.query)
        if parts[:1] == ["playlist"] and query.get("list"):
            return "youtube_playlist", query["list"][0]
        if parts[:1] == ["watch"] and query.get("v"):
            return "youtube_track", query["v"][0]
    if host == "youtu.be" and parts:
        return "youtube_track", parts[0]
    raise ValueError("Unsupported link. Use a public Spotify or YouTube playlist or track.")


def _track_from_entity(entity: dict) -> dict:
    artists = entity.get("artists") or []
    artist = ", ".join(a.get("name", "") if isinstance(a, dict) else str(a) for a in artists).strip(", ")
    if not artist:
        artist = str(entity.get("subtitle") or "").strip()
    duration = entity.get("duration") or entity.get("durationMs") or 0
    if isinstance(duration, dict):
        duration = duration.get("totalMilliseconds") or duration.get("milliseconds") or 0
    covers = (entity.get("coverArt") or {}).get("sources") or []
    cover = covers[-1].get("url", "") if covers else ""
    return {"title": entity.get("name") or entity.get("title") or "", "artist": artist, "duration": round(float(duration) / 1000, 2) if duration else 0, "cover": cover}


def parse_spotify_embed(html: str) -> dict:
    match = NEXT_DATA.search(html)
    if not match:
        raise ValueError("Spotify no longer exposes public page data.")
    try:
        page = json.loads(unescape(match.group(1)))
        props = page["props"]["pageProps"]
        entity = props.get("state", {}).get("data", {}).get("entity") or props.get("entity")
        if not isinstance(entity, dict):
            raise KeyError("entity")
        items = entity.get("trackList") or (entity.get("tracks") or {}).get("items") or []
        if not items and entity.get("type") == "track":
            items = [entity]
        tracks = []
        for item in items:
            track = item.get("track", item)
            if isinstance(track, dict):
                track = dict(track)
                track.setdefault("subtitle", item.get("subtitle", ""))
                normalized = _track_from_entity(track)
                if normalized["title"]:
                    tracks.append(normalized)
        if not tracks:
            raise ValueError("Spotify returned no tracks for this public link.")
        return {"title": entity.get("name") or entity.get("title") or "Spotify playlist", "tracks": tracks}
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Unrecognized Spotify page format.") from exc


def fetch_spotify(kind: str, source_id: str) -> dict:
    request = Request(
        f"https://open.spotify.com/embed/{kind}/{source_id}",
        headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "it-IT,it;q=0.9"},
    )
    tls = ssl.create_default_context(cafile=certifi.where())
    with urlopen(request, timeout=20, context=tls) as response:
        html = response.read().decode("utf-8")
    if kind == "track":
        return parse_spotify_embed(html)
    match = NEXT_DATA.search(html)
    if not match:
        raise ValueError("Spotify no longer exposes public playlist data.")
    try:
        page = json.loads(unescape(match.group(1)))
        token = page["props"]["pageProps"]["state"]["settings"]["session"]["accessToken"]
    except (KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Spotify does not allow reading the full playlist without signing in.") from exc
    tracks = []
    offset = 0
    title = "Spotify playlist"
    while True:
        params = urlencode({
            "operationName": "fetchPlaylist",
            "variables": json.dumps({"uri": f"spotify:playlist:{source_id}", "offset": offset, "limit": 100, "enableWatchFeedEntrypoint": False, "includeEpisodeContentRatingsV2": False}, separators=(",", ":")),
            "extensions": json.dumps({"persistedQuery": {"version": 1, "sha256Hash": "a65e12194ed5fc443a1cdebed5fabe33ca5b07b987185d63c72483867ad13cb4"}}, separators=(",", ":")),
        })
        page_request = Request(f"https://api-partner.spotify.com/pathfinder/v1/query?{params}", headers={"Authorization": f"Bearer {token}", "app-platform": "WebPlayer", "User-Agent": "Mozilla/5.0"})
        try:
            with urlopen(page_request, timeout=20, context=tls) as response:
                payload = json.load(response)
            playlist = payload["data"]["playlistV2"]
            content = playlist["content"]
            items = content["items"]
            total = content["totalCount"]
            title = playlist.get("name") or title
        except Exception as exc:
            raise ValueError("Spotify changed access to the public playlist; import stopped rather than using a partial list.") from exc
        for item in items:
            track = ((item or {}).get("itemV2") or {}).get("data") or {}
            if track.get("__typename") != "Track" or not track.get("name"):
                continue
            album = track.get("albumOfTrack") or {}
            artists = [a.get("profile", {}).get("name", "") for a in (track.get("artists") or {}).get("items") or []]
            covers = (album.get("coverArt") or {}).get("sources") or []
            tracks.append({"title": track["name"], "artist": ", ".join(a for a in artists if a), "album": album.get("name") or "", "duration": ((track.get("trackDuration") or {}).get("totalMilliseconds") or 0) / 1000, "cover": covers[-1].get("url", "") if covers else ""})
        offset += len(items)
        if offset >= total:
            break
        if not items:
            raise ValueError("Spotify returned only part of the playlist.")
    if not tracks:
        raise ValueError("The public Spotify playlist contains no readable tracks.")
    return {"title": title, "tracks": tracks}
