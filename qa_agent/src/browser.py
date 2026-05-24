from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import Browser, BrowserContext, Page, Playwright, sync_playwright

from .logger import get_logger
from .models import AppConfig, QAReport, ConsoleLogEntry, FailedRequestEntry, NetworkErrorEntry, PageErrorEntry


@dataclass
class BrowserSession:
    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page


def start_browser_session(
    config: AppConfig,
    report: QAReport,
    video_dir: Path,
) -> BrowserSession:
    logger = get_logger()
    playwright = sync_playwright().start()
    browser = playwright.chromium.launch(headless=config.headless)
    context_kwargs = {
        "viewport": {
            "width": config.viewport.width,
            "height": config.viewport.height,
        }
    }
    if config.record_video:
        context_kwargs["record_video_dir"] = str(video_dir)

    context = browser.new_context(**context_kwargs)
    context.set_default_timeout(config.timeout_ms)

    if config.save_trace:
        context.tracing.start(screenshots=True, snapshots=True, sources=True)

    page = context.new_page()
    _attach_event_listeners(page, report)
    logger.info("Sessao Chromium iniciada. Headless=%s", config.headless)
    return BrowserSession(
        playwright=playwright,
        browser=browser,
        context=context,
        page=page,
    )


def stop_browser_session(
    session: BrowserSession | None,
    report: QAReport,
    trace_path: Path | None,
    video_dir: Path | None,
    save_trace: bool,
) -> None:
    logger = get_logger()
    if session is None:
        return

    try:
        if save_trace and trace_path is not None:
            session.context.tracing.stop(path=str(trace_path))
            report.trace = str(trace_path)
    except Exception as exc:  # pragma: no cover - depende do browser real
        logger.warning("Falha ao salvar trace: %s", exc)
    finally:
        try:
            session.context.close()
        finally:
            session.browser.close()
            session.playwright.stop()

    if video_dir and video_dir.exists():
        report.videos.extend(str(path) for path in sorted(video_dir.glob("*.webm")))


def _attach_event_listeners(page: Page, report: QAReport) -> None:
    page.on("console", lambda msg: report.console_logs.append(
        ConsoleLogEntry(
            level=msg.type,
            text=msg.text,
            location=_format_console_location(msg.location),
        )
    ))

    page.on("pageerror", lambda error: report.page_errors.append(
        PageErrorEntry(message=str(error))
    ))

    page.on("requestfailed", lambda request: report.failed_requests.append(
        FailedRequestEntry(
            url=request.url,
            method=request.method,
            resource_type=request.resource_type,
            failure_text=str(request.failure or ""),
        )
    ))

    page.on("response", lambda response: _capture_failed_response(report, response))


def _capture_failed_response(report: QAReport, response) -> None:
    try:
        if response.status >= 400:
            report.network_errors.append(
                NetworkErrorEntry(
                    url=response.url,
                    status=response.status,
                    method=response.request.method,
                    resource_type=response.request.resource_type,
                    status_text=response.status_text,
                )
            )
    except Exception:
        return


def _format_console_location(location: dict) -> str:
    if not location:
        return ""
    url = location.get("url", "")
    line_number = location.get("lineNumber")
    column_number = location.get("columnNumber")
    parts = [url] if url else []
    if line_number is not None:
        parts.append(f"line {line_number}")
    if column_number is not None:
        parts.append(f"column {column_number}")
    return " | ".join(parts)
