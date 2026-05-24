from __future__ import annotations

from dataclasses import dataclass


AUTH_UI_SELECTORS = [
    "[data-page]",
    ".nav-btn",
    "#pageTitle",
    "#page-inicio",
]


@dataclass
class NavTarget:
    label: str
    selector: str
    key: str


def run_authenticated_tests(runtime) -> None:
    expected = (
        "Depois do login, o agente deve permanecer autenticado e explorar as telas internas "
        "visiveis de forma segura."
    )
    if not runtime.config.post_login_explore:
        runtime.add_step(
            step_id="AUTH_001",
            name="Exploracao autenticada pos-login",
            status="skipped",
            details="POST_LOGIN_EXPLORE=false.",
            expected_result=expected,
            actual_result="Exploracao autenticada desabilitada por configuracao.",
            severity="informational",
        )
        return

    if not runtime.report.metadata.get("authenticated") and not _has_authenticated_ui(runtime.page):
        runtime.add_step(
            step_id="AUTH_001",
            name="Exploracao autenticada pos-login",
            status="skipped",
            details="Nao foi detectada uma area autenticada ativa apos os testes iniciais.",
            expected_result=expected,
            actual_result="Sem sessao autenticada confirmada para continuar a navegacao interna.",
            severity="informational",
            url=runtime.page.url if runtime.page else runtime.config.app_url,
        )
        return

    runtime.report.metadata["authenticated"] = True
    surface = _detect_app_surface(runtime.page)
    runtime.report.metadata["authenticated_surface"] = surface

    nav_targets = _discover_nav_targets(runtime, surface)
    if not nav_targets:
        screenshot, _ = runtime.capture("authenticated_nav_missing")
        runtime.add_step(
            step_id="AUTH_001",
            name="Exploracao autenticada pos-login",
            status="warning",
            details="A sessao autenticada foi detectada, mas nenhum item de navegacao interno foi encontrado.",
            expected_result=expected,
            actual_result="Nao foi possivel mapear telas internas para exploracao segura.",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
        return

    runtime.add_step(
        step_id="AUTH_001",
        name="Exploracao autenticada pos-login",
        status="passed",
        details=f"Area autenticada detectada ({surface}). Itens planejados: {', '.join(t.label for t in nav_targets)}.",
        expected_result=expected,
        actual_result="O agente permaneceu autenticado e iniciou a exploracao interna.",
        severity="informational",
        url=runtime.page.url,
    )

    for index, target in enumerate(nav_targets, start=1):
        _visit_nav_target(runtime, target, index, surface)


def _visit_nav_target(runtime, target: NavTarget, index: int, surface: str) -> None:
    expected = "A tela interna deve abrir sem erro tecnico imediato e gerar evidencia visual."
    try:
        _ensure_transient_overlays_closed(runtime)
        locator = runtime.page.locator(target.selector).first
        locator.wait_for(state="visible", timeout=runtime.config.timeout_ms)
        locator.click()
        runtime.paced_wait("view")
        screenshot, screenshot_error = runtime.capture(f"auth_{target.key}")
        details = f"Tela '{target.label}' visitada com sucesso."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        actual = f"Tela ativa apos clique: {_current_view_label(runtime.page, target.label)}."
        runtime.add_step(
            step_id=f"AUTH_NAV_{index:03d}",
            name=f"Explorar tela autenticada: {target.label}",
            status="passed",
            details=details,
            expected_result=expected,
            actual_result=actual,
            severity="informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
        _run_page_specific_checks(runtime, target, surface)
    except Exception as exc:
        screenshot, _ = runtime.capture(f"auth_{target.key}_error")
        runtime.add_step(
            step_id=f"AUTH_NAV_{index:03d}",
            name=f"Explorar tela autenticada: {target.label}",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao visitar a tela interna '{target.label}': {exc}",
            severity="medium",
            url=runtime.page.url if runtime.page else runtime.config.app_url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _run_page_specific_checks(runtime, target: NavTarget, surface: str) -> None:
    try:
        if target.key == "audios":
            _probe_audio_gallery(runtime, target)
            _probe_audio_transcript(runtime, target)
            return

        if runtime.config.safe_audio_test and (
            target.key in {"inicio", "rotina", "audios21"} or _has_visible_audio_control(runtime.page)
        ):
            _probe_audio_experience(runtime, target)
            _probe_audio_transcript(runtime, target)

        if surface == "student" and target.key in {"inicio", "rotina"}:
            if runtime.config.safe_meditation_preview:
                _probe_meditation_session(runtime, target)
            _probe_reading_experience(runtime, target)
    finally:
        _ensure_transient_overlays_closed(runtime)


def _probe_audio_experience(runtime, target: NavTarget) -> None:
    expected = (
        "Quando houver audio disponivel, o player deve abrir ou exibir controles visiveis "
        "sem exigir acao destrutiva."
    )
    try:
        control = _audio_trigger(runtime.page)
        if control is None:
            runtime.add_step(
                step_id=f"AUDIO_{target.key.upper()}",
                name=f"Validar experiencia de audio: {target.label}",
                status="skipped",
                details="Nenhum controle de audio visivel foi encontrado nesta tela.",
                expected_result=expected,
                actual_result="A tela nao expunha um player de audio acionavel no momento do teste.",
                severity="informational",
                url=runtime.page.url,
            )
            return

        control.click()
        runtime.paced_wait("media", extra_ms=runtime.config.audio_probe_seconds * 1000)
        player_visible = _player_visible(runtime.page)
        screenshot, screenshot_error = runtime.capture(f"audio_{target.key}")

        status = "passed" if player_visible else "warning"
        details = "Controle de audio acionado."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        actual = (
            "Player ou mini player visivel apos a interacao."
            if player_visible
            else "Nao foi possivel confirmar visualmente a abertura do player apos a interacao."
        )
        runtime.add_step(
            step_id=f"AUDIO_{target.key.upper()}",
            name=f"Validar experiencia de audio: {target.label}",
            status=status,
            details=details,
            expected_result=expected,
            actual_result=actual,
            severity="medium" if status == "warning" else "informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
    except Exception as exc:
        screenshot, _ = runtime.capture(f"audio_{target.key}_error")
        runtime.add_step(
            step_id=f"AUDIO_{target.key.upper()}",
            name=f"Validar experiencia de audio: {target.label}",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao validar o audio da tela '{target.label}': {exc}",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _probe_audio_gallery(runtime, target: NavTarget) -> None:
    expected = (
        "A galeria de audios deve carregar e permitir reproduzir em sequencia os primeiros audios "
        "disponiveis por um periodo configurado."
    )
    try:
        runtime.wait_for_any_visible([".audio-list-item"], timeout_ms=runtime.config.timeout_ms)
        items = runtime.page.locator(".audio-list-item")
        available: list[int] = []
        for index in range(items.count()):
            item = items.nth(index)
            onclick = item.get_attribute("onclick") or ""
            if "initAudioPlayerByDia" in onclick:
                available.append(index)
            if len(available) >= runtime.config.audio_gallery_items:
                break

        if not available:
            runtime.add_step(
                step_id="AUDIO_GALLERY_000",
                name="Validar galeria de audios",
                status="warning",
                details="A tela de audios abriu, mas nenhum item disponivel para reproducao foi encontrado.",
                expected_result=expected,
                actual_result="Nao havia audios disponiveis para teste na galeria.",
                severity="medium",
                url=runtime.page.url,
            )
            return

        for offset, item_index in enumerate(available, start=1):
            item = runtime.page.locator(".audio-list-item").nth(item_index)
            label = (item.inner_text() or "").strip().replace("\n", " ")
            item.click()
            runtime.paced_wait("media", extra_ms=runtime.config.audio_listen_seconds * 1000)
            player_visible = _player_visible(runtime.page)
            screenshot, screenshot_error = runtime.capture(f"audio_gallery_{offset}")
            _ensure_transient_overlays_closed(runtime)

            status = "passed" if player_visible else "warning"
            details = f"Audio da galeria testado: {label or f'item {offset}'}."
            if screenshot_error:
                details = f"{details} Screenshot nao gerado: {screenshot_error}"
            actual = (
                f"Audio reproduzido por aproximadamente {runtime.config.audio_listen_seconds}s."
                if player_visible
                else "Nao foi possivel confirmar a reproducao visual do audio na galeria."
            )
            runtime.add_step(
                step_id=f"AUDIO_GALLERY_{offset:03d}",
                name=f"Reproduzir audio da galeria #{offset}",
                status=status,
                details=details,
                expected_result=expected,
                actual_result=actual,
                severity="medium" if status == "warning" else "informational",
                url=runtime.page.url,
                evidence=[screenshot] if screenshot else [],
            )
    except Exception as exc:
        screenshot, _ = runtime.capture("audio_gallery_error")
        runtime.add_step(
            step_id="AUDIO_GALLERY_999",
            name="Validar galeria de audios",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao percorrer a galeria de audios: {exc}",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _probe_audio_transcript(runtime, target: NavTarget) -> None:
    expected = "Quando existir transcricao, o painel deve abrir e exibir o conteudo ou o estado de carregamento."
    try:
        control = _audio_trigger(runtime.page)
        if control is None:
            runtime.add_step(
                step_id=f"TRANSCRIPT_{target.key.upper()}",
                name=f"Validar transcricao de audio: {target.label}",
                status="skipped",
                details="Nao havia player de audio acessivel para abrir a transcricao.",
                expected_result=expected,
                actual_result="Fluxo de transcricao nao pode ser iniciado sem player.",
                severity="informational",
                url=runtime.page.url,
            )
            return

        control.click()
        runtime.paced_wait("media")
        transcript_toggle = _first_visible(runtime.page, [".player-transcript-toggle"])
        if transcript_toggle is None:
            runtime.add_step(
                step_id=f"TRANSCRIPT_{target.key.upper()}",
                name=f"Validar transcricao de audio: {target.label}",
                status="skipped",
                details="O player abriu, mas este audio nao expunha botao de transcricao.",
                expected_result=expected,
                actual_result="Nao havia transcricao configurada para o audio testado.",
                severity="informational",
                url=runtime.page.url,
            )
            return

        transcript_toggle.click()
        runtime.paced_wait("action", extra_ms=3000)
        body_visible = runtime.wait_for_any_visible(
            ["#transcriptBody", ".player-loading-row.show", ".player-error-msg.show"],
            timeout_ms=runtime.config.action_wait_ms + 5000,
        )
        screenshot, screenshot_error = runtime.capture(f"transcript_{target.key}")

        status = "passed" if body_visible else "warning"
        details = "Botao de transcricao acionado."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        actual = (
            "Transcricao ou estado de carregamento/erro ficou visivel no player."
            if body_visible
            else "A area de transcricao nao ficou visivel no tempo esperado."
        )
        runtime.add_step(
            step_id=f"TRANSCRIPT_{target.key.upper()}",
            name=f"Validar transcricao de audio: {target.label}",
            status=status,
            details=details,
            expected_result=expected,
            actual_result=actual,
            severity="medium" if status == "warning" else "informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
    except Exception as exc:
        screenshot, _ = runtime.capture(f"transcript_{target.key}_error")
        runtime.add_step(
            step_id=f"TRANSCRIPT_{target.key.upper()}",
            name=f"Validar transcricao de audio: {target.label}",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao validar a transcricao do audio: {exc}",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _probe_meditation_session(runtime, target: NavTarget) -> None:
    expected = (
        "A jornada de meditacao deve abrir, avancar pelas telas de preparo, iniciar a sessao "
        "e permitir sair sem concluir os 15 minutos."
    )
    try:
        trigger = _first_visible(runtime.page, ["#pilar_meditacao", "[onclick*='openMeditacao']"])
        if trigger is None:
            runtime.add_step(
                step_id=f"MEDIT_{target.key.upper()}",
                name=f"Validar meditacao guiada: {target.label}",
                status="skipped",
                details="Nenhum atalho seguro para abrir a meditacao foi encontrado nesta tela.",
                expected_result=expected,
                actual_result="A experiencia de meditacao nao estava visivel para teste nesta tela.",
                severity="informational",
                url=runtime.page.url,
            )
            return

        trigger.click()
        runtime.page.locator("#medOverlay").wait_for(state="visible", timeout=runtime.config.timeout_ms)
        runtime.paced_wait("action", extra_ms=2000)

        for selector in ["#medS1 .med-btn-next", "#medS2 .med-btn-next"]:
            button = runtime.page.locator(selector)
            if button.count() == 0:
                continue
            button.first.click()
            runtime.paced_wait("action", extra_ms=1000)

        start_button = runtime.page.locator("#medS3 .med-btn-start").first
        start_visible = start_button.is_visible()
        session_visible = False
        if start_visible:
            start_button.click()
            runtime.paced_wait("action", extra_ms=4000)
            session_visible = runtime.wait_for_any_visible(
                ["#medSession", "#medPauseBtn", "#medTimerDisp"],
                timeout_ms=runtime.config.action_wait_ms + 8000,
            )

            pause_button = runtime.page.locator("#medPauseBtn")
            if pause_button.count() > 0 and pause_button.first.is_visible():
                pause_button.first.click()
                runtime.paced_wait("action", extra_ms=1000)
                pause_button.first.click()
                runtime.paced_wait("action", extra_ms=1000)

            exit_button = runtime.page.locator(".med-exit-btn")
            if exit_button.count() > 0 and exit_button.first.is_visible():
                exit_button.first.click()
                runtime.paced_wait("action", extra_ms=1000)

        screenshot, screenshot_error = runtime.capture(f"meditation_session_{target.key}")

        status = "passed" if start_visible and session_visible else "warning"
        details = "Fluxo de meditacao aberto e exercitado sem concluir a sessao."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        actual = (
            "Foi possivel chegar ao preparo final, iniciar a sessao, validar controles basicos e sair."
            if start_visible and session_visible
            else "A experiencia abriu, mas nao foi possivel confirmar toda a transicao ate a sessao ativa."
        )
        runtime.add_step(
            step_id=f"MEDIT_{target.key.upper()}",
            name=f"Validar meditacao guiada: {target.label}",
            status=status,
            details=details,
            expected_result=expected,
            actual_result=actual,
            severity="medium" if status == "warning" else "informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
    except Exception as exc:
        screenshot, _ = runtime.capture(f"meditation_session_{target.key}_error")
        runtime.add_step(
            step_id=f"MEDIT_{target.key.upper()}",
            name=f"Validar meditacao guiada: {target.label}",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao validar a meditacao guiada: {exc}",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _probe_reading_experience(runtime, target: NavTarget) -> None:
    expected = (
        "A experiencia de leitura deve abrir a biblioteca, permitir selecionar um livro, "
        "passar pelo onboarding e abrir o leitor ate o estado final visivel, incluindo erro quando existir."
    )
    try:
        trigger = _first_visible(runtime.page, ["#pilar_leitura", "[onclick*='openLeitura']"])
        if trigger is None:
            runtime.add_step(
                step_id=f"READ_{target.key.upper()}",
                name=f"Validar experiencia de leitura: {target.label}",
                status="skipped",
                details="Nenhum atalho de leitura visivel foi encontrado nesta tela.",
                expected_result=expected,
                actual_result="A leitura nao estava acessivel para teste nesta tela.",
                severity="informational",
                url=runtime.page.url,
            )
            return

        trigger.click()
        runtime.page.locator("#leituraOverlay").wait_for(state="visible", timeout=runtime.config.timeout_ms)
        runtime.paced_wait("action", extra_ms=2000)

        if not runtime.wait_for_any_visible(["#leitBookGrid", ".leit-book-card"], timeout_ms=runtime.config.action_wait_ms + 5000):
            raise RuntimeError("Biblioteca da leitura nao ficou visivel no tempo esperado.")

        book = _first_visible(runtime.page, [".leit-book-card"])
        if book is None:
            raise RuntimeError("Nenhum livro disponivel foi encontrado na biblioteca.")

        book.click()
        runtime.paced_wait("action", extra_ms=1000)

        step2 = runtime.page.locator("#leitScreen2 .leit-btn-primary")
        if step2.count() == 0 or not step2.first.is_visible():
            raise RuntimeError("Botao de avancar do onboarding da leitura nao ficou visivel.")
        step2.first.click()
        runtime.paced_wait("action", extra_ms=1000)

        step3 = runtime.page.locator("#leitScreen3 .leit-btn-primary")
        if step3.count() == 0 or not step3.first.is_visible():
            raise RuntimeError("Botao de iniciar leitura nao ficou visivel.")
        step3.first.click()
        runtime.paced_wait("action", extra_ms=5000)

        final_visible = runtime.wait_for_any_visible(
            ["#leitErrorBox:not(.hidden)", "#leitPageInfo", "#leitLoadingOverlay", "#leitEpubContainer"],
            timeout_ms=runtime.config.timeout_ms,
        )
        screenshot, screenshot_error = runtime.capture(f"reading_{target.key}")

        nav_next = _first_visible(runtime.page, ["#leitNavNext", ".leit-tap-zone.right"])
        if nav_next is not None:
            nav_next.click()
            runtime.paced_wait("action", extra_ms=1000)

        error_visible = runtime.wait_for_any_visible(["#leitErrorBox:not(.hidden)"], timeout_ms=1500)

        status = "passed" if final_visible else "warning"
        details = "Fluxo de leitura exercitado sem marcar o pilar."
        if screenshot_error:
            details = f"{details} Screenshot nao gerado: {screenshot_error}"
        actual = (
            "O leitor abriu ou exibiu a caixa final de erro/carregamento como estado observavel."
            if final_visible
            else "O fluxo abriu, mas o leitor nao chegou a um estado final observavel no tempo esperado."
        )
        if error_visible:
            actual += " A caixa de erro da leitura ficou visivel."
        runtime.add_step(
            step_id=f"READ_{target.key.upper()}",
            name=f"Validar experiencia de leitura: {target.label}",
            status=status,
            details=details,
            expected_result=expected,
            actual_result=actual,
            severity="medium" if status == "warning" else "informational",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
        )
    except Exception as exc:
        screenshot, _ = runtime.capture(f"reading_{target.key}_error")
        runtime.add_step(
            step_id=f"READ_{target.key.upper()}",
            name=f"Validar experiencia de leitura: {target.label}",
            status="failed",
            details=str(exc),
            expected_result=expected,
            actual_result=f"Falha ao validar a experiencia de leitura: {exc}",
            severity="medium",
            url=runtime.page.url,
            evidence=[screenshot] if screenshot else [],
            logs=[str(exc)],
        )
    finally:
        _ensure_transient_overlays_closed(runtime)


def _discover_nav_targets(runtime, surface: str) -> list[NavTarget]:
    page = runtime.page
    max_items = runtime.config.max_nav_items
    targets: list[NavTarget] = []

    if surface == "student":
        locator = page.locator(".nav-btn")
        count = min(locator.count(), max_items + 2)
        for index in range(count):
            item = locator.nth(index)
            if not item.is_visible():
                continue
            item_id = item.get_attribute("id") or ""
            label = (item.inner_text() or "").strip().replace("\n", " ")
            key = item_id.removeprefix("nav-") if item_id else f"student-{index + 1}"
            selector = f"#{item_id}" if item_id else f".nav-btn >> nth={index}"
            targets.append(NavTarget(label=label or key, selector=selector, key=key))
            if len(targets) >= max_items:
                break
        return targets

    if surface == "admin":
        locator = page.locator("[data-page]")
        count = min(locator.count(), max_items + 4)
        for index in range(count):
            item = locator.nth(index)
            if not item.is_visible():
                continue
            key = item.get_attribute("data-page") or f"admin-{index + 1}"
            label = (item.inner_text() or item.get_attribute("title") or key).strip().replace("\n", " ")
            selector = f'[data-page="{key}"]'
            targets.append(NavTarget(label=label or key, selector=selector, key=key))
            if len(targets) >= max_items:
                break
        return targets

    return targets


def _detect_app_surface(page) -> str:
    try:
        if page.locator(".nav-btn").count() > 0:
            return "student"
        if page.locator("[data-page]").count() > 0:
            return "admin"
    except Exception:
        return "unknown"
    return "unknown"


def _has_authenticated_ui(page) -> bool:
    for selector in AUTH_UI_SELECTORS:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            if locator.first.is_visible():
                return True
        except Exception:
            continue
    return False


def _current_view_label(page, fallback: str) -> str:
    for selector in ["#pageTitle", ".nav-btn.active span", "[data-page].active .nav-label", ".page.active"]:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            text = (locator.first.inner_text() or "").strip()
            if text:
                return text.replace("\n", " ")
            element_id = locator.first.get_attribute("id") or ""
            if element_id:
                return element_id
        except Exception:
            continue
    return fallback


def _has_visible_audio_control(page) -> bool:
    return _audio_trigger(page) is not None


def _audio_trigger(page):
    return _first_visible(
        page,
        [
            "#playBtnInicio",
            "#playBtnRotina",
            ".audio-list-item",
            ".play-btn",
            "[onclick*='initAudioPlayer']",
        ],
    )


def _player_visible(page) -> bool:
    selectors = [
        "#expandedPlayer.player-overlay.open",
        "#miniPlayer.mini-player.active",
        "#epMainBtn",
        "#miniPlayBtn",
    ]
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            if locator.first.is_visible():
                return True
        except Exception:
            continue
    return False


def _ensure_transient_overlays_closed(runtime) -> None:
    if runtime.page is None:
        return

    runtime.page.evaluate(
        """
        () => {
          try { if (typeof closeAudio === 'function') closeAudio(); } catch (e) {}
          try { if (typeof closeMeditacao === 'function') closeMeditacao(); } catch (e) {}
          try { if (typeof closeLeitura === 'function') closeLeitura(); } catch (e) {}
          try {
            const ep = document.getElementById('expandedPlayer');
            if (ep) ep.classList.remove('open');
          } catch (e) {}
          try {
            const mp = document.getElementById('miniPlayer');
            if (mp) mp.classList.remove('active');
          } catch (e) {}
          try {
            const med = document.getElementById('medOverlay');
            if (med) med.classList.remove('active');
          } catch (e) {}
          try {
            const leit = document.getElementById('leituraOverlay');
            if (leit) leit.classList.remove('active');
          } catch (e) {}
        }
        """
    )
    runtime.short_wait(500)


def _first_visible(page, selectors: list[str]):
    for selector in selectors:
        locator = page.locator(selector)
        if locator.count() == 0:
            continue
        try:
            candidate = locator.first
            if candidate.is_visible():
                return candidate
        except Exception:
            continue
    return None
