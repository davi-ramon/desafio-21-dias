from __future__ import annotations

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError


AUTHENTICATED_UI_SELECTORS = [
    "[data-page]",
    ".nav-btn",
    "#pageTitle",
    "#content",
    "#page-inicio",
    "#sidebar",
]


def run_login_tests(runtime) -> bool:
    expected = "O login de teste deve ocorrer apenas quando URL e credenciais estiverem configuradas."
    if not runtime.config.has_login_prerequisites():
        runtime.report.metadata["authenticated"] = False
        runtime.add_step(
            step_id="LOGIN_001",
            name="Teste de login opcional",
            status="skipped",
            details="LOGIN_URL, TEST_EMAIL ou TEST_PASSWORD nao foram configurados.",
            expected_result=expected,
            actual_result="Fluxo ignorado por falta de prerequisitos seguros.",
            severity="informational",
        )
        return False

    page = runtime.page
    initial_url = runtime.page.url if runtime.page else runtime.config.app_url
    try:
        page.goto(runtime.config.login_url, wait_until="domcontentloaded")
        runtime.wait_for_any_visible(
            ["#email", "input[type='email']", "input[name='email']"],
            timeout_ms=10000,
        )

        email = _first_visible(page, ["#email", "input[type='email']", "input[name='email']"])
        password = _first_visible(page, ["#password", "input[type='password']", "input[name='password']"])
        submit = _first_visible(
            page,
            ["#btnLogin", "button[type='submit']", "button:has-text('Entrar')", "input[type='submit']"],
        )

        if not all([email, password, submit]):
            runtime.report.metadata["authenticated"] = False
            screenshot, _ = runtime.capture("login_missing_selectors")
            runtime.add_step(
                step_id="LOGIN_001",
                name="Teste de login opcional",
                status="warning",
                details="Nao foi possivel localizar todos os elementos necessarios do login.",
                expected_result=expected,
                actual_result="Seletores de login nao encontrados com seguranca.",
                severity="medium",
                url=page.url,
                evidence=[screenshot] if screenshot else [],
            )
            return False

        email.fill(runtime.config.test_email)
        password.fill(runtime.config.test_password)
        runtime.short_wait(350)
        submit.click()
        runtime.paced_wait("post_login")

        screenshot, screenshot_error = runtime.capture("login_attempt")
        current_url = page.url
        success = (
            current_url != runtime.config.login_url
            or _has_authenticated_ui(page)
            or runtime.wait_for_any_visible(
                AUTHENTICATED_UI_SELECTORS,
                timeout_ms=runtime.config.post_login_wait_ms,
            )
        )
        if success:
            runtime.report.metadata["authenticated"] = True
            runtime.report.metadata["post_login_url"] = current_url
            details = "Fluxo de login executado sem erro tecnico imediato."
            if screenshot_error:
                details = f"{details} Screenshot nao gerado: {screenshot_error}"
            runtime.add_step(
                step_id="LOGIN_001",
                name="Teste de login opcional",
                status="passed",
                details=details,
                expected_result=expected,
                actual_result=f"Login testado e pagina mudou para {current_url}.",
                severity="informational",
                url=current_url,
                evidence=[screenshot] if screenshot else [],
            )
            return True
        else:
            runtime.report.metadata["authenticated"] = False
            runtime.add_step(
                step_id="LOGIN_001",
                name="Teste de login opcional",
                status="warning",
                details="A URL permaneceu na tela de login apos a tentativa.",
                expected_result=expected,
                actual_result="Nao houve redirecionamento confirmado apos o clique em Entrar.",
                severity="medium",
                url=current_url,
                evidence=[screenshot] if screenshot else [],
            )
            return False
    except PlaywrightTimeoutError as exc:
        runtime.report.metadata["authenticated"] = False
        screenshot, _ = runtime.capture("login_timeout")
        runtime.add_step(
            step_id="LOGIN_001",
            name="Teste de login opcional",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Timeout durante o fluxo de login: {exc}",
            severity="high",
            url=runtime.config.login_url or initial_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
        return False
    except Exception as exc:
        runtime.report.metadata["authenticated"] = False
        screenshot, _ = runtime.capture("login_error")
        runtime.add_step(
            step_id="LOGIN_001",
            name="Teste de login opcional",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha inesperada no fluxo de login: {exc}",
            severity="high",
            url=runtime.config.login_url or initial_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
        return False


def _first_visible(page, selectors: list[str]):
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        candidate = locator.first
        if candidate.is_visible():
            return candidate
    return None


def _has_authenticated_ui(page) -> bool:
    for selector in AUTHENTICATED_UI_SELECTORS:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            if locator.first.is_visible():
                return True
        except Exception:
            continue
    return False
