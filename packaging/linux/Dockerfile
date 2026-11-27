FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive \
    PATH="/root/.cargo/bin:/opt/node/bin:${PATH}" \
    APPIMAGE_EXTRACT_AND_RUN=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential ca-certificates curl file git libayatana-appindicator3-dev \
    libfuse2 libssl-dev libwebkit2gtk-4.1-dev libxdo-dev patchelf \
    pkg-config python3 python3-pip python3-venv libpython3.10-dev librsvg2-dev wget xz-utils \
    gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fL --retry 3 https://nodejs.org/dist/v24.16.0/node-v24.16.0-linux-x64.tar.xz -o /tmp/node.tar.xz \
    && echo 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9  /tmp/node.tar.xz' | sha256sum -c - \
    && mkdir -p /opt/node \
    && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node \
    && rm /tmp/node.tar.xz

RUN curl -fL --retry 3 https://sh.rustup.rs -o /tmp/rustup.sh \
    && sh /tmp/rustup.sh -y --profile minimal \
    && rm /tmp/rustup.sh

WORKDIR /workspace
COPY . .

RUN python3 -m venv .venv \
    && .venv/bin/python -m pip install --no-cache-dir -r requirements.txt -r requirements-build.txt
RUN if [ -d tests ]; then .venv/bin/python -m unittest discover -s tests -v; fi
RUN cd frontend && npm ci
RUN cd frontend && npm run sidecar:build \
    && npm run desktop:build -- --config src-tauri/tauri.linux.conf.json

FROM scratch
COPY --from=builder /workspace/frontend/src-tauri/target/release/bundle/ /bundle/
