from __future__ import annotations

import argparse
from pathlib import Path

from src.report_builder import rebuild_markdown_report
from src.utils import MARKDOWN_REPORTS_DIR, RAW_REPORTS_DIR


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Regenera um relatorio Markdown a partir de um JSON bruto.",
    )
    parser.add_argument(
        "--raw-report",
        help="Caminho para o arquivo JSON bruto. Se omitido, usa o mais recente.",
    )
    args = parser.parse_args()

    raw_path = Path(args.raw_report) if args.raw_report else _latest_raw_report()
    if raw_path is None or not raw_path.exists():
        print("Nenhum relatorio bruto encontrado em reports/raw.")
        return 1

    markdown_path = rebuild_markdown_report(raw_path, MARKDOWN_REPORTS_DIR)
    print(f"Relatorio Markdown gerado em: {markdown_path}")
    return 0


def _latest_raw_report() -> Path | None:
    candidates = sorted(RAW_REPORTS_DIR.glob("*.json"))
    return candidates[-1] if candidates else None


if __name__ == "__main__":
    raise SystemExit(main())
