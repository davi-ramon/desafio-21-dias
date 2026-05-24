from __future__ import annotations

from pathlib import Path

from playwright.sync_api import Page

from .logger import get_logger
from .utils import slugify


class EvidenceManager:
    def __init__(self, run_id: str, screenshot_dir: Path):
        self.run_id = run_id
        self.screenshot_dir = screenshot_dir
        self.logger = get_logger()

    def capture_screenshot(
        self,
        page: Page | None,
        label: str,
        *,
        full_page: bool = True,
    ) -> tuple[str | None, str | None]:
        if page is None:
            return None, "Nao foi possivel capturar screenshot porque a pagina nao foi criada."

        file_name = f"{self.run_id}_{slugify(label)}.png"
        file_path = self.screenshot_dir / file_name
        try:
            page.screenshot(path=str(file_path), full_page=full_page)
            return str(file_path), None
        except Exception as exc:  # pragma: no cover - depende do browser real
            self.logger.warning("Falha ao capturar screenshot '%s': %s", label, exc)
            return None, str(exc)
