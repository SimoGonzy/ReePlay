"""Load local, data-only user theme manifests."""

import json
import re
from pathlib import Path


COLOR_KEYS = {
    "bg", "sidebar", "surface", "text", "muted", "border", "accent",
    "accent_text", "selected", "row_alt", "player", "danger", "positive",
}


def load_plugin_themes(folder: Path) -> list[dict]:
    themes = []
    if not folder.is_dir():
        return themes
    for path in sorted(folder.glob("*.json")):
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            theme_id = manifest["id"]
            name = manifest["name"]
            style = manifest.get("style", "flat")
            colors = manifest["colors"]
            if not (isinstance(theme_id, str) and re.fullmatch(r"[a-z][a-z0-9_-]{1,31}", theme_id)):
                continue
            if not (isinstance(name, str) and 1 <= len(name.strip()) <= 40):
                continue
            if style not in ("flat", "glossy") or not isinstance(colors, dict):
                continue
            if not colors or any(key not in COLOR_KEYS or not isinstance(value, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", value) for key, value in colors.items()):
                continue
            themes.append({"id": f"plugin:{theme_id}", "name": name.strip(), "style": style, "colors": colors})
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return themes
