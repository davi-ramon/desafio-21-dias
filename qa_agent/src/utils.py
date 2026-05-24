from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


ROOT_DIR = Path(__file__).resolve().parents[1]
REPORTS_DIR = ROOT_DIR / "reports"
SCREENSHOTS_DIR = REPORTS_DIR / "screenshots"
TRACES_DIR = REPORTS_DIR / "traces"
VIDEOS_DIR = REPORTS_DIR / "videos"
RAW_REPORTS_DIR = REPORTS_DIR / "raw"
MARKDOWN_REPORTS_DIR = REPORTS_DIR / "markdown"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def local_timestamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")


def slugify(value: str, default: str = "artifact") -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]+", "-", value.strip().lower()).strip("-")
    return cleaned or default


def is_valid_http_url(url: str) -> bool:
    if not url:
        return False
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def parse_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def ensure_report_directories() -> None:
    for path in (
        REPORTS_DIR,
        SCREENSHOTS_DIR,
        TRACES_DIR,
        VIDEOS_DIR,
        RAW_REPORTS_DIR,
        MARKDOWN_REPORTS_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)


def ensure_run_directories(run_id: str, create_videos: bool) -> dict[str, Path]:
    ensure_report_directories()
    screenshot_dir = SCREENSHOTS_DIR / run_id
    trace_dir = TRACES_DIR / run_id
    video_dir = VIDEOS_DIR / run_id
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    trace_dir.mkdir(parents=True, exist_ok=True)
    if create_videos:
        video_dir.mkdir(parents=True, exist_ok=True)
    return {
        "screenshots": screenshot_dir,
        "traces": trace_dir,
        "videos": video_dir,
        "raw": RAW_REPORTS_DIR,
        "markdown": MARKDOWN_REPORTS_DIR,
    }


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
