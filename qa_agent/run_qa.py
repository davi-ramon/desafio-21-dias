try:
    from src.test_runner import run_qa
except ModuleNotFoundError as exc:
    missing = exc.name or "dependencia"

    def run_qa() -> int:
        print(
            "Dependencia ausente para executar o QA Agent: "
            f"{missing}. Instale as dependencias com 'pip install -r requirements.txt' "
            "e, em seguida, rode 'python -m playwright install chromium'."
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(run_qa())
