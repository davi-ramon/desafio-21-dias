from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

from .models import AppConfig, Viewport
from .utils import ROOT_DIR, is_valid_http_url, parse_bool


class ConfigError(Exception):
    """Raised when configuration is invalid for the requested execution."""


def load_app_config() -> AppConfig:
    load_dotenv(ROOT_DIR / ".env")

    config_path = ROOT_DIR / "config.json"
    file_data = _load_json_if_exists(config_path)
    load_issues: list[str] = []

    viewport_data = file_data.get("viewport", {}) if file_data else {}
    config = AppConfig(
        project_name=_pick_value("PROJECT_NAME", file_data, "project_name", "App 21 Dias"),
        app_url=_pick_value("APP_URL", file_data, "app_url", ""),
        login_url=_pick_value("LOGIN_URL", file_data, "login_url", ""),
        test_email=_pick_value("TEST_EMAIL", file_data, "test_email", ""),
        test_password=_pick_value("TEST_PASSWORD", file_data, "test_password", ""),
        headless=parse_bool(_pick_value("HEADLESS", file_data, "headless", False), default=False),
        record_video=parse_bool(
            _pick_value("RECORD_VIDEO", file_data, "record_video", True),
            default=True,
        ),
        save_trace=parse_bool(
            _pick_value("SAVE_TRACE", file_data, "save_trace", True),
            default=True,
        ),
        timeout_ms=_safe_int(
            _pick_value("TIMEOUT_MS", file_data, "timeout_ms", 30000),
            default=30000,
            label="TIMEOUT_MS",
            issues=load_issues,
        ),
        post_login_explore=parse_bool(
            _pick_value("POST_LOGIN_EXPLORE", file_data, "post_login_explore", True),
            default=True,
        ),
        safe_audio_test=parse_bool(
            _pick_value("SAFE_AUDIO_TEST", file_data, "safe_audio_test", True),
            default=True,
        ),
        safe_meditation_preview=parse_bool(
            _pick_value("SAFE_MEDITATION_PREVIEW", file_data, "safe_meditation_preview", True),
            default=True,
        ),
        max_nav_items=_safe_int(
            _pick_value("MAX_NAV_ITEMS", file_data, "max_nav_items", 8),
            default=8,
            label="MAX_NAV_ITEMS",
            issues=load_issues,
        ),
        audio_probe_seconds=_safe_int(
            _pick_value("AUDIO_PROBE_SECONDS", file_data, "audio_probe_seconds", 3),
            default=3,
            label="AUDIO_PROBE_SECONDS",
            issues=load_issues,
        ),
        initial_wait_ms=_safe_int(
            _pick_value("INITIAL_WAIT_MS", file_data, "initial_wait_ms", 15000),
            default=15000,
            label="INITIAL_WAIT_MS",
            issues=load_issues,
        ),
        post_login_wait_ms=_safe_int(
            _pick_value("POST_LOGIN_WAIT_MS", file_data, "post_login_wait_ms", 15000),
            default=15000,
            label="POST_LOGIN_WAIT_MS",
            issues=load_issues,
        ),
        action_wait_ms=_safe_int(
            _pick_value("ACTION_WAIT_MS", file_data, "action_wait_ms", 12000),
            default=12000,
            label="ACTION_WAIT_MS",
            issues=load_issues,
        ),
        view_load_wait_ms=_safe_int(
            _pick_value("VIEW_LOAD_WAIT_MS", file_data, "view_load_wait_ms", 12000),
            default=12000,
            label="VIEW_LOAD_WAIT_MS",
            issues=load_issues,
        ),
        audio_gallery_items=_safe_int(
            _pick_value("AUDIO_GALLERY_ITEMS", file_data, "audio_gallery_items", 5),
            default=5,
            label="AUDIO_GALLERY_ITEMS",
            issues=load_issues,
        ),
        audio_listen_seconds=_safe_int(
            _pick_value("AUDIO_LISTEN_SECONDS", file_data, "audio_listen_seconds", 60),
            default=60,
            label="AUDIO_LISTEN_SECONDS",
            issues=load_issues,
        ),
        viewport=Viewport(
            width=_safe_int(
                viewport_data.get("width", 1366),
                default=1366,
                label="viewport.width",
                issues=load_issues,
            ),
            height=_safe_int(
                viewport_data.get("height", 768),
                default=768,
                label="viewport.height",
                issues=load_issues,
            ),
        ),
        config_source="config.json + .env" if config_path.exists() else ".env/defaults",
        load_issues=load_issues,
    )
    return config


def validate_config(config: AppConfig) -> list[str]:
    issues: list[str] = list(config.load_issues)
    if not config.app_url:
        issues.append("APP_URL nao foi configurada.")
    elif not is_valid_http_url(config.app_url):
        issues.append(f"APP_URL invalida: {config.app_url}")

    if config.login_url and not is_valid_http_url(config.login_url):
        issues.append(f"LOGIN_URL invalida: {config.login_url}")

    if config.timeout_ms <= 0:
        issues.append("TIMEOUT_MS deve ser maior que zero.")
    if config.max_nav_items <= 0:
        issues.append("MAX_NAV_ITEMS deve ser maior que zero.")
    if config.audio_probe_seconds <= 0:
        issues.append("AUDIO_PROBE_SECONDS deve ser maior que zero.")
    if config.initial_wait_ms <= 0:
        issues.append("INITIAL_WAIT_MS deve ser maior que zero.")
    if config.post_login_wait_ms <= 0:
        issues.append("POST_LOGIN_WAIT_MS deve ser maior que zero.")
    if config.action_wait_ms <= 0:
        issues.append("ACTION_WAIT_MS deve ser maior que zero.")
    if config.view_load_wait_ms <= 0:
        issues.append("VIEW_LOAD_WAIT_MS deve ser maior que zero.")
    if config.audio_gallery_items <= 0:
        issues.append("AUDIO_GALLERY_ITEMS deve ser maior que zero.")
    if config.audio_listen_seconds <= 0:
        issues.append("AUDIO_LISTEN_SECONDS deve ser maior que zero.")

    return issues


def _load_json_if_exists(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _pick_value(env_key: str, file_data: dict, file_key: str, default):
    env_value = os.getenv(env_key)
    if env_value not in (None, ""):
        return env_value
    if file_key in file_data:
        return file_data[file_key]
    return default


def _safe_int(value, default: int, label: str, issues: list[str]) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        issues.append(f"Valor invalido para {label}: {value!r}. Usando padrao {default}.")
        return default
