from __future__ import annotations


SAFE_NAV_SELECTORS = [
    "[data-page]",
    "nav a",
    "aside button",
    "button",
    "a",
]


def run_navigation_tests(runtime) -> None:
    expected = "O app deve expor links ou botoes principais visiveis para navegacao segura."
    try:
        if not runtime.wait_for_any_visible(
            ["#email", "#password", "#btnLogin", "button:has-text('Entrar')"],
            timeout_ms=1200,
        ):
            runtime.paced_wait("view")
        visible_labels: list[str] = []
        for selector in SAFE_NAV_SELECTORS:
            locator = runtime.page.locator(selector)
            count = min(locator.count(), 15)
            for index in range(count):
                item = locator.nth(index)
                if not item.is_visible():
                    continue
                text = (item.inner_text() or "").strip()
                title = item.get_attribute("title") or ""
                label = text or title or selector
                if label not in visible_labels:
                    visible_labels.append(label)
                if len(visible_labels) >= 8:
                    break
            if visible_labels:
                break

        if visible_labels:
            screenshot, screenshot_error = runtime.capture("navigation_visible")
            details = f"Elementos visiveis detectados: {', '.join(visible_labels)}."
            if screenshot_error:
                details = f"{details} Screenshot nao gerado: {screenshot_error}"
            runtime.add_step(
                step_id="NAV_001",
                name="Verificar links e botoes visiveis principais",
                status="passed",
                details=details,
                expected_result=expected,
                actual_result="Foi possivel identificar elementos principais visiveis de navegacao.",
                severity="informational",
                url=runtime.page.url,
                evidence=[screenshot] if screenshot else [],
            )
        else:
            screenshot, _ = runtime.capture("navigation_missing")
            runtime.add_step(
                step_id="NAV_001",
                name="Verificar links e botoes visiveis principais",
                status="warning",
                details="Nenhum elemento de navegacao seguro foi identificado pelos seletores basicos.",
                expected_result=expected,
                actual_result="A heuristica de navegacao nao encontrou elementos visiveis suficientes.",
                severity="low",
                url=runtime.page.url,
                evidence=[screenshot] if screenshot else [],
            )
    except Exception as exc:
        screenshot, _ = runtime.capture("navigation_error")
        runtime.add_step(
            step_id="NAV_001",
            name="Verificar links e botoes visiveis principais",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao inspecionar navegacao: {exc}",
            severity="medium",
            url=runtime.page.url if runtime.page else runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
