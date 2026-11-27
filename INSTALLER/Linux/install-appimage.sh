#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ "$#" -gt 1 ]; then
  echo 'Uso: sh install-appimage.sh [percorso/ReePlay.AppImage]' >&2
  exit 2
fi
if [ "$#" -eq 0 ]; then
  set -- "$script_dir"/ReePlay_*_amd64.AppImage
  if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
    echo 'Metti un solo file ReePlay_*_amd64.AppImage accanto a questo script, oppure indicane il percorso.' >&2
    exit 2
  fi
fi
appimage=$1
icon="$script_dir/ReePlay.png"
if [ ! -f "$appimage" ] || [ ! -f "$icon" ]; then
  echo 'Mancano l’AppImage o ReePlay.png. Tienili accanto allo script.' >&2
  exit 2
fi

bin_dir="$HOME/.local/bin"
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
applications_dir="$data_home/applications"
icons_dir="$data_home/icons/hicolor/128x128/apps"
mkdir -p "$bin_dir" "$applications_dir" "$icons_dir"
executable="$bin_dir/reeplay"
install -m 755 "$appimage" "$executable"
install -m 644 "$icon" "$icons_dir/reeplay.png"

# Desktop Entry Exec requires escaping reserved characters in absolute paths.
escaped_executable=$(printf '%s' "$executable" | sed \
  -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/`/\\`/g' \
  -e 's/\$/\\$/g' -e 's/%/%%/g')
cat > "$applications_dir/ReePlay.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ReePlay
Comment=Lettore musicale locale
Exec="$escaped_executable"
Icon=reeplay
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupWMClass=reeplay
EOF
chmod 644 "$applications_dir/ReePlay.desktop"

printf 'ReePlay installata: %s\nVoce nel menu: %s\n' "$executable" "$applications_dir/ReePlay.desktop"
