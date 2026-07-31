# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

"""Per-session user metadata (favorite, nickname, comments).

This data is user-owned and NOT part of any framework's transcript, so it lives
outside the source data, in the AgentSim cache alongside ``config.json``:

    <base>/sessions_configs/<framework>/<session_id>.json

Keying on ``(framework, session_id)`` -- never on a source id -- means the
metadata is independent of which data source surfaced the session, so removing
and re-adding a source restores the user's stars/nicknames/comments.

Files are created lazily: a session has no file until the user sets something,
and a file that reverts to all-defaults is deleted so the tree only holds real
user data.
"""

import json
from pathlib import Path

from app.models import SessionUserConfig, SessionUserConfigUpdate


class SessionConfigStore:
    def __init__(self, base_dir: Path | str) -> None:
        # ``base_dir`` is the config dir (the parent of ``config.json``).
        self._root = Path(base_dir) / "sessions_configs"

    def _path(self, framework: str, session_id: str) -> Path:
        return self._root / framework / f"{session_id}.json"

    def get(self, framework: str, session_id: str) -> SessionUserConfig:
        """The stored config for a session, or all-defaults if none exists."""
        path = self._path(framework, session_id)
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return SessionUserConfig()
        if not isinstance(data, dict):
            return SessionUserConfig()
        return SessionUserConfig(
            is_favorite=bool(data.get("is_favorite", False)),
            nickname=str(data.get("nickname", "") or ""),
            comments=str(data.get("comments", "") or ""),
        )

    def update(
        self, framework: str, session_id: str, patch: SessionUserConfigUpdate
    ) -> SessionUserConfig:
        """Merge non-None patch fields onto the current config and persist.

        When the merged result is all-defaults the file is deleted (or never
        created), so the store only ever holds sessions the user cared about.
        """
        current = self.get(framework, session_id)
        merged = SessionUserConfig(
            is_favorite=current.is_favorite if patch.is_favorite is None else patch.is_favorite,
            nickname=current.nickname if patch.nickname is None else patch.nickname,
            comments=current.comments if patch.comments is None else patch.comments,
        )

        path = self._path(framework, session_id)
        if merged == SessionUserConfig():
            path.unlink(missing_ok=True)
            return merged

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(merged.model_dump(), indent=2), encoding="utf-8")
        return merged
