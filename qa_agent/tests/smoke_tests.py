from __future__ import annotations

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


def run_smoke_tests(runtime) -> None:
    _test_access_home(runtime)
    _test_body_loaded(runtime)
    _test_console_health(runtime)


def _test_access_home(runtime) -> None:
    expected = "A pagina inicial deve abrir e concluir o carregamento basico."
    try:
        runtime.page.goto(runtime.config.app_url, wait_until="domcontentloaded")
        if _is_login_screen(runtime):
            runtime.short_wait(800)
        else:
            runtime.paced_wait("initial")
        screenshot, screenshot_error = runtime.capture("home_initial")
        details = "Pagina inicial carregada com sucesso."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        runtime.add_step(
            step_id="SMOKE_001",
            name="Acessar pagina inicial",
            status="passed",
            details=details,
            expected_result=expected,
            actual_result="Pagina inicial aberta e estabilizada.",
            severity="informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
    except PlaywrightTimeoutError as exc:
        screenshot, _ = runtime.capture("home_initial_timeout")
        runtime.add_step(
            step_id="SMOKE_001",
            name="Acessar pagina inicial",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Timeout ao carregar a pagina principal: {exc}",
            severity="critical",
            url=runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    except Exception as exc:
        screenshot, _ = runtime.capture("home_initial_error")
        runtime.add_step(
            step_id="SMOKE_001",
            name="Acessar pagina inicial",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao acessar a pagina principal: {exc}",
            severity="critical",
            url=runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )


def _test_body_loaded(runtime) -> None:
    expected = "O elemento body deve ficar visivel apos a carga inicial."
    try:
        if not _is_login_screen(runtime):
            runtime.paced_wait("action")
        runtime.page.locator("body").wait_for(state="visible", timeout=runtime.config.timeout_ms)
        runtime.add_step(
            step_id="SMOKE_002",
            name="Verificar se o body carregou",
            status="passed",
            details="Elemento body visivel.",
            expected_result=expected,
            actual_result="O body ficou visivel dentro do timeout configurado.",
            severity="informational",
            url=runtime.page.url,
        )
    except Exception as exc:
        screenshot, _ = runtime.capture("body_not_visible")
        runtime.add_step(
            step_id="SMOKE_002",
            name="Verificar se o body carregou",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"O body nao ficou visivel: {exc}",
            severity="high",
            url=runtime.page.url if runtime.page else runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )


def _test_console_health(runtime) -> None:
    expected = "Nao devem existir erros criticos no console apos a carga inicial."
    error_logs = [
        log for log in runtime.report.console_logs
        if log.level.lower() in {"error", "assert"}
    ]
    if error_logs:
        screenshot, _ = runtime.capture("console_errors")
        runtime.add_step(
            step_id="SMOKE_003",
            name="Verificar se nao ha erro critico no console",
            status="warning",
            details=f"Foram encontrados {len(error_logs)} erros no console.",
            expected_result=expected,
            actual_result="O frontend registrou erros no console apos a carga inicial.",
            severity="medium",
            url=runtime.page.url if runtime.page else runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[f"{log.level}: {log.text}" for log in error_logs[:10]],
        )
        return

    runtime.add_step(
        step_id="SMOKE_003",
        name="Verificar se nao ha erro critico no console",
        status="passed",
        details="Nenhum erro critico foi encontrado no console.",
        expected_result=expected,
        actual_result="Nao houve erros criticos de console na carga inicial.",
        severity="informational",
        url=runtime.page.url if runtime.page else runtime.config.app_url,
    )


def _is_login_screen(runtime) -> bool:
    return runtime.wait_for_any_visible(
        ["#email", "#password", "#btnLogin", "button:has-text('Entrar')"],
        timeout_ms=1500,
    )
