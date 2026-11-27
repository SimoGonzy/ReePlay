"""Local API process bundled with the Tauri desktop application."""

import os
import socket
import sys
from pathlib import Path

if getattr(sys, "frozen", False):
    os.environ.setdefault("MUSICAPP_DATA_DIR", str(Path.home() / "Documents" / "MusicApp"))
    configured_tools = os.environ.get("MUSICAPP_TOOLS_DIR")
    bundled_tools = (Path(configured_tools) if configured_tools else
                     Path(sys.executable).resolve().parent / "bundled-tools")
    if bundled_tools.is_dir():
        os.environ["PATH"] = str(bundled_tools) + os.pathsep + os.environ.get("PATH", "")

import uvicorn

from musicapp.server import app


def main() -> None:
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(2048)
    port = listener.getsockname()[1]
    print(f"MUSICAPP_PORT={port}", flush=True)
    server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False))
    server.run(sockets=[listener])


if __name__ == "__main__":
    main()
