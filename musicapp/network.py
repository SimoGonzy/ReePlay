"""Opt-in, read-only LAN music sharing and pinned-TLS client connections."""

import hashlib
import http.client
import ipaddress
import json
import os
import secrets
import socket
import ssl
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import uvicorn
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from mutagen.id3 import ID3
from pydantic import BaseModel, Field
from zeroconf import ServiceBrowser, ServiceInfo, ServiceListener, Zeroconf
import ifaddr

from .storage import Library, safe_name


SERVICE_TYPE = "_musicapp._tcp.local."
DEFAULT_PORT = 38473
PRIVATE_NETWORKS = tuple(ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))


def _write_private(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data)
    if os.name != "nt":
        temporary.chmod(0o600)
    temporary.replace(path)


def _local_address(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError as exc:
        raise ValueError("Inserisci un indirizzo IP, non un nome host.") from exc
    if not isinstance(address, ipaddress.IPv4Address) or not (address.is_loopback or address.is_link_local or any(address in network for network in PRIVATE_NETWORKS)):
        raise ValueError("È consentito soltanto un indirizzo IPv4 della rete locale.")
    return str(address)


def _addresses() -> list[str]:
    found = set()
    try:
        for adapter in ifaddr.get_adapters():
            for item in adapter.ips:
                if isinstance(item.ip, str):
                    address = ipaddress.ip_address(item.ip)
                    if isinstance(address, ipaddress.IPv4Address) and not address.is_loopback and (address.is_link_local or any(address in network for network in PRIVATE_NETWORKS)):
                        found.add(str(address))
    except (OSError, ValueError):
        pass
    routable = [address for address in found if not ipaddress.ip_address(address).is_link_local]
    if routable:
        found = set(routable)
    preferred = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            preferred = probe.getsockname()[0]
    except OSError:
        pass
    return sorted(found, key=lambda address: (address != preferred, address))


def _reachable_address(addresses: list[str], port: int) -> str:
    own = _addresses()
    def rank(address):
        prefix = address.rsplit(".", 1)[0]
        return (not any(local.rsplit(".", 1)[0] == prefix for local in own), own.index(address) if address in own else len(own))
    ordered = sorted(addresses, key=rank)
    for address in ordered:
        try:
            with socket.create_connection((address, port), timeout=0.4):
                return address
        except OSError:
            continue
    return ordered[0]


class PairRequest(BaseModel):
    code: str
    name: str = Field(max_length=80)


class InspectRequest(BaseModel):
    host: str
    port: int = Field(ge=1, le=65535)


class ConnectRequest(InspectRequest):
    fingerprint: str
    code: str


class NetworkManager:
    def __init__(self, library: Library, config_dir: Path):
        self.library = library
        self.config_dir = Path(config_dir)
        self._lock = threading.RLock()
        self._server = None
        self._thread = None
        self._socket = None
        self._zeroconf = None
        self._service = None
        self.port = None
        self._code = None
        self._code_expiry = 0.0
        self._failures = {}
        self._settings = self._read("settings.json", {"id": uuid.uuid4().hex, "name": socket.gethostname()[:80], "clients": []})
        if not (self.config_dir / "settings.json").is_file():
            self._save("settings.json", self._settings)
        self._peers = self._read("peers.json", [])
        self.lan_app = self._make_lan_app()

    def _read(self, name, fallback):
        try:
            return json.loads((self.config_dir / name).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return fallback

    def _save(self, name, value):
        _write_private(self.config_dir / name, json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8"))

    def _identity(self):
        cert_file = self.config_dir / "server.crt"
        key_file = self.config_dir / "server.key"
        if not (cert_file.is_file() and key_file.is_file()):
            key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "ReePlay " + self._settings["id"])])
            now = datetime.now(timezone.utc)
            cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
                    .public_key(key.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=3650))
                    .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                    .sign(key, hashes.SHA256()))
            _write_private(key_file, key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
            _write_private(cert_file, cert.public_bytes(serialization.Encoding.PEM))
        cert = x509.load_pem_x509_certificate(cert_file.read_bytes())
        return cert_file, key_file, hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()

    def status(self):
        with self._lock:
            fingerprint = self._identity()[2] if self.port else None
            return {"enabled": self.port is not None, "port": self.port,
                    "name": self._settings["name"], "addresses": _addresses(),
                    "fingerprint": fingerprint, "clients": [{"id": c["id"], "name": c["name"]} for c in self._settings["clients"]],
                    "code": self._code if time.monotonic() < self._code_expiry else None,
                    "peers": [{"id": p["id"], "name": p["name"], "host": p["host"], "port": p["port"]} for p in self._peers]}

    def start(self, host="0.0.0.0"):
        with self._lock:
            if self.port:
                return self.status()
            cert, key, fingerprint = self._identity()
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            try:
                listener.bind((host, DEFAULT_PORT))
            except OSError:
                try:
                    listener.bind((host, 0))
                except OSError:
                    listener.close()
                    raise
            listener.listen(128)
            self._socket = listener
            self.port = listener.getsockname()[1]
            self._server = uvicorn.Server(uvicorn.Config(self.lan_app, ssl_certfile=str(cert), ssl_keyfile=str(key), log_level="warning", access_log=False))
            self._thread = threading.Thread(target=self._server.run, kwargs={"sockets": [listener]}, daemon=True, name="musicapp-lan")
            self._thread.start()
            try:
                addresses = [socket.inet_aton(address) for address in _addresses()]
                if host != "127.0.0.1" and addresses:
                    self._zeroconf = Zeroconf()
                    self._service = ServiceInfo(SERVICE_TYPE, f"{self._settings['id']}.{SERVICE_TYPE}",
                                                addresses=addresses, port=self.port,
                                                properties={"name": self._settings["name"], "fingerprint": fingerprint, "id": self._settings["id"]},
                                                server=f"{self._settings['id']}.local.")
                    self._zeroconf.register_service(self._service)
            except Exception:
                if self._zeroconf:
                    self._zeroconf.close()
                self._zeroconf = None
                self._service = None
            return self.status()

    def stop(self):
        with self._lock:
            self._code = None
            self._code_expiry = 0
            if self._zeroconf:
                if self._service:
                    self._zeroconf.unregister_service(self._service)
                self._zeroconf.close()
                self._zeroconf = None
                self._service = None
            if self._server:
                self._server.should_exit = True
            thread = self._thread
            self.port = None
            self._server = None
            self._thread = None
        if thread:
            thread.join(timeout=3)
        return self.status()

    def new_code(self):
        with self._lock:
            if not self.port:
                raise ValueError("Attiva prima la condivisione.")
            self._code = f"{secrets.randbelow(1000000):06d}"
            self._code_expiry = time.monotonic() + 300
            return self.status()

    def revoke(self, client_id):
        with self._lock:
            before = len(self._settings["clients"])
            self._settings["clients"] = [c for c in self._settings["clients"] if c["id"] != client_id]
            if before == len(self._settings["clients"]):
                raise KeyError(client_id)
            self._save("settings.json", self._settings)

    def set_name(self, name: str):
        name = name.strip()[:80]
        if not name:
            raise ValueError("Inserisci un nome per questo PC.")
        with self._lock:
            self._settings["name"] = name
            self._save("settings.json", self._settings)
            if self._zeroconf and self._service:
                self._service = ServiceInfo(SERVICE_TYPE, f"{self._settings['id']}.{SERVICE_TYPE}",
                                            addresses=[socket.inet_aton(address) for address in _addresses()], port=self.port,
                                            properties={"name": name, "fingerprint": self._identity()[2], "id": self._settings["id"]},
                                            server=f"{self._settings['id']}.local.")
                self._zeroconf.update_service(self._service)
        return self.status()

    def forget(self, peer_id):
        with self._lock:
            before = len(self._peers)
            self._peers = [p for p in self._peers if p["id"] != peer_id]
            if before == len(self._peers):
                raise KeyError(peer_id)
            self._save("peers.json", self._peers)

    def _authorized(self, request):
        token = request.headers.get("authorization", "").removeprefix("Bearer ")
        digest = hashlib.sha256(token.encode()).hexdigest()
        if not token or not any(secrets.compare_digest(c["digest"], digest) for c in self._settings["clients"]):
            raise HTTPException(401, "Dispositivo non autorizzato.")

    def _media_path(self, playlist, filename):
        if filename != Path(filename).name or filename in (".", "..") or not filename.lower().endswith(".mp3"):
            raise HTTPException(400, "Percorso non valido.")
        try:
            folder = self.library.root if playlist == "_singles" else self.library.playlist_folder(playlist)
        except (ValueError, FileNotFoundError):
            raise HTTPException(404, "Playlist non trovata.")
        target = folder / filename
        if not target.resolve().is_relative_to(self.library.root.resolve()) or not target.is_file():
            raise HTTPException(404, "Brano non trovato.")
        return target

    def _make_lan_app(self):
        app = FastAPI(title="ReePlay LAN", docs_url=None, redoc_url=None, openapi_url=None)

        @app.middleware("http")
        async def local_clients_only(request: Request, call_next):
            try:
                _local_address(request.client.host if request.client else "")
            except ValueError:
                return Response(status_code=403)
            return await call_next(request)

        @app.get("/v1/identity")
        def identity():
            return {"id": self._settings["id"], "name": self._settings["name"]}

        @app.post("/v1/pair")
        def pair(body: PairRequest, request: Request):
            address = request.client.host if request.client else "unknown"
            with self._lock:
                attempts = [t for t in self._failures.get(address, []) if time.monotonic() - t < 300]
                if len(attempts) >= 5:
                    raise HTTPException(429, "Troppi tentativi. Riprova tra cinque minuti.")
                if not self._code or time.monotonic() >= self._code_expiry or not secrets.compare_digest(body.code, self._code):
                    attempts.append(time.monotonic())
                    self._failures[address] = attempts
                    raise HTTPException(403, "Codice non valido o scaduto.")
                self._code = None
                self._code_expiry = 0
                token = secrets.token_urlsafe(32)
                client_id = uuid.uuid4().hex
                self._settings["clients"].append({"id": client_id, "name": body.name.strip()[:80] or "Computer", "digest": hashlib.sha256(token.encode()).hexdigest()})
                self._save("settings.json", self._settings)
                return {"id": client_id, "token": token, "name": self._settings["name"], "server_id": self._settings["id"]}

        @app.get("/v1/library")
        def catalog(request: Request):
            self._authorized(request)
            return {"playlists": self.library.list_playlists(), "singles": self.library.list_singles()}

        @app.get("/v1/media/{playlist}/{filename}")
        def media(playlist: str, filename: str, request: Request):
            self._authorized(request)
            return FileResponse(self._media_path(playlist, filename), media_type="audio/mpeg")

        @app.get("/v1/art/{playlist}/{filename}")
        def art(playlist: str, filename: str, request: Request):
            self._authorized(request)
            try:
                frames = ID3(self._media_path(playlist, filename)).getall("APIC")
                if frames:
                    return Response(frames[0].data, media_type=frames[0].mime, headers={"X-Content-Type-Options": "nosniff"})
            except HTTPException:
                raise
            except Exception:
                pass
            raise HTTPException(404, "Copertina non trovata.")

        @app.get("/v1/cover/{playlist}")
        def cover(playlist: str, request: Request):
            self._authorized(request)
            try:
                file = self.library.cover_file(playlist)
            except (ValueError, FileNotFoundError):
                raise HTTPException(404, "Copertina non trovata.")
            if not file.resolve().is_relative_to(self.library.root.resolve()):
                raise HTTPException(404, "Copertina non trovata.")
            return FileResponse(file, media_type={".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp"}[file.suffix.lower()])

        return app

    def _connection(self, host, port, fingerprint=None):
        host = _local_address(host)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        connection = http.client.HTTPSConnection(host, port, context=context, timeout=12)
        connection.connect()
        actual = hashlib.sha256(connection.sock.getpeercert(binary_form=True)).hexdigest()
        if fingerprint is not None and not secrets.compare_digest(actual, fingerprint.lower()):
            connection.close()
            raise ValueError("L'identità del server è cambiata. Connessione interrotta.")
        return connection, actual

    def _request(self, host, port, path, fingerprint, token=None, body=None, range_header=None):
        connection, actual = self._connection(host, port, fingerprint)
        try:
            headers = {"Accept": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            if body is not None:
                headers["Content-Type"] = "application/json"
            if range_header:
                headers["Range"] = range_header
            connection.request("POST" if body is not None else "GET", path, body=json.dumps(body).encode() if body is not None else None, headers=headers)
            return connection, connection.getresponse(), actual
        except Exception:
            connection.close()
            raise

    def inspect(self, host, port):
        connection, response, fingerprint = self._request(host, port, "/v1/identity", None)
        try:
            if response.status != 200:
                raise ValueError("Il PC non risponde come server ReePlay.")
            info = json.loads(response.read(65536))
            return {"host": _local_address(host), "port": port, "id": info["id"], "name": info["name"], "fingerprint": fingerprint}
        finally:
            connection.close()

    def connect(self, host, port, fingerprint, code):
        if len(fingerprint) != 64 or any(c not in "0123456789abcdefABCDEF" for c in fingerprint):
            raise ValueError("Impronta del server non valida.")
        connection, response, _ = self._request(host, port, "/v1/pair", fingerprint, body={"code": code, "name": socket.gethostname()[:80]})
        try:
            result = json.loads(response.read(65536))
            if response.status != 200:
                raise ValueError(result.get("detail", "Associazione non riuscita."))
            peer = {"id": result["server_id"], "name": result["name"], "host": _local_address(host),
                    "port": port, "fingerprint": fingerprint.lower(), "token": result["token"]}
            with self._lock:
                self._peers = [p for p in self._peers if p["id"] != peer["id"]] + [peer]
                self._save("peers.json", self._peers)
            return {k: peer[k] for k in ("id", "name", "host", "port")}
        finally:
            connection.close()

    def _peer(self, peer_id):
        peer = next((p for p in self._peers if p["id"] == peer_id), None)
        if peer is None:
            raise KeyError(peer_id)
        return peer

    def remote_library(self, peer_id):
        peer = self._peer(peer_id)
        connection, response, _ = self._request(peer["host"], peer["port"], "/v1/library", peer["fingerprint"], peer["token"])
        try:
            if response.status == 401:
                raise PermissionError("Accesso revocato dal computer remoto.")
            if response.status != 200:
                raise OSError("Catalogo remoto non disponibile.")
            raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Catalogo remoto troppo grande.")
            return json.loads(raw)
        finally:
            connection.close()

    def proxy(self, peer_id, kind, playlist, filename=None, range_header=None):
        peer = self._peer(peer_id)
        path = f"/v1/{kind}/{quote(playlist, safe='')}"
        if filename is not None:
            path += "/" + quote(filename, safe="")
        connection, response, _ = self._request(peer["host"], peer["port"], path, peer["fingerprint"], peer["token"], range_header=range_header)
        if response.status not in (200, 206):
            connection.close()
            raise HTTPException(response.status if response.status in (401, 404, 416) else 502, "Contenuto remoto non disponibile.")
        headers = {name: value for name in ("content-length", "content-range", "accept-ranges", "etag", "last-modified") if (value := response.getheader(name))}
        headers["X-Content-Type-Options"] = "nosniff"

        def chunks():
            try:
                while chunk := response.read(64 * 1024):
                    yield chunk
            finally:
                connection.close()

        return StreamingResponse(chunks(), status_code=response.status, media_type=response.getheader("content-type", "application/octet-stream"), headers=headers)

    def discover(self, timeout=2.0):
        found = {}
        own_id = self._settings["id"]

        class Listener(ServiceListener):
            def add_service(self, zc, service_type, name):
                info = zc.get_service_info(service_type, name, timeout=1000)
                if not info:
                    return
                properties = {k.decode(errors="replace"): v.decode(errors="replace") for k, v in info.properties.items() if v is not None}
                addresses = []
                for address in info.parsed_addresses():
                    try:
                        addresses.append(_local_address(address))
                    except ValueError:
                        pass
                if properties.get("id") != own_id and addresses:
                    found[properties.get("id", name)] = {"id": properties.get("id", name), "name": properties.get("name", name),
                                                          "host": _reachable_address(addresses, info.port), "port": info.port, "fingerprint": properties.get("fingerprint", "")}

            def update_service(self, zc, service_type, name):
                self.add_service(zc, service_type, name)

            def remove_service(self, zc, service_type, name):
                pass

        zc = Zeroconf()
        browser = ServiceBrowser(zc, SERVICE_TYPE, Listener())
        try:
            time.sleep(timeout)
        finally:
            browser.cancel()
            zc.close()
        with self._lock:
            changed = False
            for item in found.values():
                for peer in self._peers:
                    if peer["id"] == item["id"] and peer["fingerprint"] == item["fingerprint"]:
                        if peer["host"] != item["host"] or peer["port"] != item["port"] or peer["name"] != item["name"]:
                            peer["host"], peer["port"], peer["name"] = item["host"], item["port"], item["name"]
                            changed = True
            if changed:
                self._save("peers.json", self._peers)
        return list(found.values())
