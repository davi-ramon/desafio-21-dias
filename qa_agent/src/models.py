from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Viewport:
    width: int = 1366
    height: int = 768


@dataclass
class AppConfig:
    project_name: str = "App 21 Dias"
    app_url: str = ""
    login_url: str = ""
    test_email: str = ""
    test_password: str = ""
    headless: bool = False
    record_video: bool = True
    save_trace: bool = True
    timeout_ms: int = 30000
    post_login_explore: bool = True
    safe_audio_test: bool = True
    safe_meditation_preview: bool = True
    max_nav_items: int = 8
    audio_probe_seconds: int = 3
    initial_wait_ms: int = 15000
    post_login_wait_ms: int = 15000
    action_wait_ms: int = 12000
    view_load_wait_ms: int = 12000
    audio_gallery_items: int = 5
    audio_listen_seconds: int = 60
    viewport: Viewport = field(default_factory=Viewport)
    config_source: str = "defaults"
    load_issues: list[str] = field(default_factory=list)

    def has_login_prerequisites(self) -> bool:
        return bool(self.login_url and self.test_email and self.test_password)


@dataclass
class StepResult:
    id: str
    name: str
    status: str
    details: str = ""
    expected_result: str = ""
    actual_result: str = ""
    severity: str = "informational"
    url: str = ""
    evidence: list[str] = field(default_factory=list)
    logs: list[str] = field(default_factory=list)


@dataclass
class ConsoleLogEntry:
    level: str
    text: str
    location: str = ""


@dataclass
class PageErrorEntry:
    message: str
    stack: str = ""


@dataclass
class NetworkErrorEntry:
    url: str
    status: int
    method: str = ""
    resource_type: str = ""
    status_text: str = ""


@dataclass
class FailedRequestEntry:
    url: str
    method: str = ""
    resource_type: str = ""
    failure_text: str = ""


@dataclass
class BugEntry:
    id: str
    title: str
    severity: str
    screen_url: str = ""
    action: str = ""
    expected_result: str = ""
    actual_result: str = ""
    evidence: list[str] = field(default_factory=list)
    technical_log: list[str] = field(default_factory=list)
    possible_cause: str = ""
    recommendation: str = ""
    source: str = ""


@dataclass
class Summary:
    total_tests: int = 0
    passed: int = 0
    failed: int = 0
    warnings: int = 0
    skipped: int = 0


@dataclass
class QAReport:
    project_name: str
    started_at: str
    finished_at: str = ""
    app_url: str = ""
    status: str = "running"
    summary: Summary = field(default_factory=Summary)
    steps: list[StepResult] = field(default_factory=list)
    console_logs: list[ConsoleLogEntry] = field(default_factory=list)
    page_errors: list[PageErrorEntry] = field(default_factory=list)
    network_errors: list[NetworkErrorEntry] = field(default_factory=list)
    failed_requests: list[FailedRequestEntry] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)
    videos: list[str] = field(default_factory=list)
    trace: str = ""
    bugs: list[BugEntry] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    ai_dev_prompt: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
