# Local Network

A PC running ReePlay can share tracks in `content/library/` with other PCs running the app on the same network. Sharing is **disabled at every launch**: open the **Local Network** tab and click **Share library** to enable it. Files stay on the host PC; other computers stream them without downloading a copy. ZIPs in `content/share/` are not exposed by the LAN server.

## Connecting two PCs

1. On the PC with the music, open **Local Network**, click **Share library**, then **Generate pairing code** (Generate pairing code). The screen shows a code valid for five minutes, an address and port, and the certificate fingerprint.
2. On the other PC, open **Local Network** and click **Search**. If the host does not appear, enter the IP address and port shown on the first PC.
3. Click **Connect**. **Compare the fingerprints** shown on both PCs, select **The fingerprints match**, and enter the code. Pairing is valid for one PC and consumes the code.
4. Open the paired computer and select a playlist or track. The player at the bottom plays the audio and lets you seek. Your local library remains available.

Use **Rename** to change the name shown to other PCs. The host's **Authorized devices** list lets you revoke a client. **Stop sharing** shuts down the service. On a client, **Remove** deletes its saved credential. A new code is required to pair it again. The server prefers TCP port `38473`; if occupied, it chooses an available port and displays it.

## Firewall and networks

Automatic discovery uses mDNS. Some corporate or guest networks and routers isolate devices and block discovery; enter the address manually in that case. On Windows, enabling sharing for the first time may show a Firewall prompt for `musicapp_backend`. Allow access only on **private networks**. The current NSIS installer runs per user without administrator privileges, so it cannot reliably create an inbound rule before the app starts. A future elevated installer could offer an explicit rule limited to the binary, Private profile, and local subnet, then remove it on uninstall. For now, use the Windows prompt. On other systems, check local firewall rules if another PC cannot connect.

## How it works and limitations

- The app's local API remains on `127.0.0.1`. A second HTTPS service opens on the LAN only after **Share library**. It exposes identity and pairing, then catalog, covers, and audio as **read-only** resources. It does not expose imports, downloads, moves, or arbitrary files.
- The loopback API checks the client address, `Host`, and `Origin` to block requests from untrusted websites and DNS rebinding. Audio and cover paths are resolved and restricted to the library root; symbolic links outside the library are not published.
- A self-signed certificate is generated when sharing first starts. The client checks its fingerprint **before sending a pairing code or credential** and pins it for future connections. If the certificate changes, the connection is blocked. Visual comparison during initial pairing matters: the code alone does not protect against an active attacker on the same network.
- Credentials are random, unique per PC, and revocable. The server stores only their hashes; the client stores its credential in its personal data folder. Do not publish or share `config/network/` files.
- Audio supports HTTP `Range` requests and passes through the client's local backend. The token is not placed in a URL read by the WebView. Embedded MP3 art and playlist covers appear when available.
- This version does not copy remote tracks, synchronize playlist changes, or allow Internet access. Remote tracks become unavailable when the host shuts down. Click **Refresh** to reload the catalog.

## Bundled dependencies

The Python engine uses `cryptography` for the TLS certificate, `zeroconf` for mDNS, and `ifaddr` to detect local addresses. They are listed in `requirements.txt` and bundled by PyInstaller through `frontend/scripts/build-sidecar.mjs`. Windows and Linux installers include them with the rest of the engine. Installer users do not need to install Python or these libraries separately.
