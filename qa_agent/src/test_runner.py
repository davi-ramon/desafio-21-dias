from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError, TimeoutError as PlaywrightTimeoutError

from .browser import BrowserSession, start_browser_session, stop_browser_session
from .config import load_app_config, validate_config
from .evidence import EvidenceManager
from .logger import get_logger
from .models import AppConfig, QAReport, StepResult
from .report_builder import finalize_report, persist_reports
from .utils import ensure_run_directories, local_timestamp, utc_now_iso
from tests.authenticated_tests import run_authenticated_tests
from tests.login_tests import run_login_tests
from tests.navigation_tests import run_navigation_tests
from tests.smoke_tests import run_smoke_tests


@dataclass
class QARuntime:
    config: AppConfig
    report: QAReport
    session: BrowserSession | None
    evidence: EvidenceManager
    run_id: str
    paths: dict[str, Path]

    @property
    def page(self):
        return self.session.page if self.session else None

    def add_step(
        self,
        *,
        step_id: str,
        name: str,
        status: str,
        details: str = "",
        expected_result: str = "",
        actual_result: str = "",
        severity: str = "informational",
        url: str = "",
        evidence: list[str] | None = None,
        logs: list[str] | None = None,
    ) -> None:
        self.report.steps.append(
            StepResult(
                id=step_id,
                name=name,
                status=status,
                details=details,
                expected_result=expected_result,
                actual_result=actual_result,
                severity=severity,
                url=url,
                evidence=evidence or [],
                logs=logs or [],
            )
        )

    def capture(self, label: str, *, full_page: bool = True) -> tuple[str | None, str | None]:
        screenshot, error = self.evidence.capture_screenshot(
            self.page,
            label,
            full_page=full_page,
        )
        if screenshot:
            self.report.screenshots.append(screenshot)
        return screenshot, error

    def paced_wait(self, phase: str = "action", extra_ms: int = 0) -> None:
        if self.page is None:
            return

        phase_map = {
            "initial": self.config.initial_wait_ms,
            "post_login": self.config.post_login_wait_ms,
            "view": self.config.view_load_wait_ms,
            "action": self.config.action_wait_ms,
            "media": max(self.config.action_wait_ms, self.config.audio_probe_seconds * 1000),
        }
        base_wait = phase_map.get(phase, self.config.action_wait_ms)

        try:
            self.page.wait_for_load_state("networkidle", timeout=self.config.timeout_ms)
        except PlaywrightTimeoutError:
            pass

        self.page.wait_for_timeout(base_wait + extra_ms)

    def wait_for_any_visible(self, selectors: list[str], timeout_ms: int | None = None) -> bool:
        if self.page is None:
            return False

        effective_timeout = timeout_ms or self.config.timeout_ms
        interval = 500
        elapsed = 0
        while elapsed <= effective_timeout:
            for selector in selectors:
                locator = self.page.locator(selector)
                if locator.count() == 0:
                    continue
                try:
                    if locator.first.is_visible():
                        return True
                except Exception:
                    continue
            self.page.wait_for_timeout(interval)
            elapsed += interval
        return False

    def short_wait(self, ms: int = 500) -> None:
        if self.page is not None:
            self.page.wait_for_timeout(ms)


def run_qa() -> int:
    logger = get_logger()
    run_id = local_timestamp()
    config = load_app_config()
    paths = ensure_run_directories(run_id, create_videos=config.record_video)
    report = QAReport(
        project_name=config.project_name,
        started_at=utc_now_iso(),
        app_url=config.app_url,
        metadata={
            "run_id": run_id,
            "config_source": config.config_source,
            "headless": config.headless,
            "record_video": config.record_video,
            "save_trace": config.save_trace,
            "timeout_ms": config.timeout_ms,
        },
    )
    runtime = QARuntime(
        config=config,
        report=report,
        session=None,
        evidence=EvidenceManager(run_id, paths["screenshots"]),
        run_id=run_id,
        paths=paths,
    )

    exit_code = 0
    validation_issues = validate_config(config)
    for issue in validation_issues:
        runtime.add_step(
            step_id="CONFIG_001",
            name="Validacao de configuracao",
            status="failed",
            details=issue,
            expected_result="Configuracao minima valida para iniciar o QA.",
            actual_result=issue,
            severity="high",
        )

    trace_path = paths["traces"] / f"{run_id}_trace.zip"

    if not validation_issues:
        try:
            runtime.session = start_browser_session(config, report, paths["videos"])
            _execute_tests(runtime)
        except PlaywrightTimeoutError as exc:
            exit_code = 1
            runtime.add_step(
                step_id="RUNTIME_001",
                name="Timeout geral da execucao",
                status="failed",
                details=str(exc),
                expected_result="A navegacao e os testes devem concluir dentro do timeout configurado.",
                actual_result=f"Timeout durante a execucao: {exc}",
                severity="critical",
                url=config.app_url,
                logs=[str(exc)],
            )
            runtime.capture("timeout_failure")
        except PlaywrightError as exc:
            exit_code = 1
            runtime.add_step(
                step_id="RUNTIME_002",
                name="Falha do Playwright",
                status="failed",
                details=str(exc),
                expected_result="O navegador deve iniciar e responder normalmente.",
                actual_result=f"Playwright retornou erro: {exc}",
                severity="critical",
                url=config.app_url,
                logs=[str(exc)],
            )
        except Exception as exc:
            exit_code = 1
            runtime.add_step(
                step_id="RUNTIME_003",
                name="Erro inesperado da execucao",
                status="failed",
                details=str(exc),
                expected_result="A execucao deve finalizar com tratamento adequado de falhas.",
                actual_result=f"Erro inesperado: {exc}",
                severity="critical",
                url=config.app_url,
                logs=[str(exc)],
            )
            runtime.capture("unexpected_failure")
        except KeyboardInterrupt:
            exit_code = 1
            runtime.add_step(
                step_id="RUNTIME_004",
                name="Execucao interrompida manualmente",
                status="warning",
                details="A execucao foi interrompida pelo usuario.",
                expected_result="O agente deveria concluir a execucao completa sem interrupcao manual.",
                actual_result="Execucao encerrada manualmente antes do fim da suite.",
                severity="medium",
                url=config.app_url,
            )
            runtime.capture("interrupted_execution")
        finally:
            stop_browser_session(
                runtime.session,
                runtime.report,
                trace_path=trace_path,
                video_dir=paths["videos"] if config.record_video else None,
                save_trace=config.save_trace,
            )
    else:
        exit_code = 1

    finalize_report(runtime.report)
    raw_path, markdown_path = persist_reports(
        runtime.report,
        raw_dir=paths["raw"],
        markdown_dir=paths["markdown"],
        run_id=run_id,
    )

    logger.info("Relatorio JSON: %s", raw_path)
    logger.info("Relatorio Markdown: %s", markdown_path)
    print(f"Relatorio JSON: {raw_path}")
    print(f"Relatorio Markdown: {markdown_path}")
    if runtime.report.trace:
        print(f"Trace: {runtime.report.trace}")
    if runtime.report.videos:
        print("Videos:")
        for video in runtime.report.videos:
            print(f" - {video}")

    if runtime.report.status in {"failed", "warning"}:
        exit_code = max(exit_code, 1)
    return exit_code


def _execute_tests(runtime: QARuntime) -> None:
    run_smoke_tests(runtime)
    run_navigation_tests(runtime)
    run_login_tests(runtime)
    run_authenticated_tests(runtime)
