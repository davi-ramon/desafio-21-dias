from __future__ import annotations

from pathlib import Path

from .ai_prompt_builder import build_ai_dev_prompt
from .models import (
    BugEntry,
    ConsoleLogEntry,
    FailedRequestEntry,
    NetworkErrorEntry,
    PageErrorEntry,
    QAReport,
    StepResult,
    Summary,
)
from .utils import read_json, utc_now_iso, write_json


def finalize_report(report: QAReport) -> QAReport:
    report.finished_at = utc_now_iso()
    report.summary = _build_summary(report.steps)
    report.bugs = _build_bugs(report)
    report.status = _resolve_overall_status(report)
    report.ai_dev_prompt = build_ai_dev_prompt(report)
    return report


def persist_reports(
    report: QAReport,
    raw_dir: Path,
    markdown_dir: Path,
    run_id: str,
) -> tuple[Path, Path]:
    raw_path = raw_dir / f"{run_id}_qa_report.json"
    markdown_path = markdown_dir / f"{run_id}_qa_report.md"
    write_json(raw_path, report.to_dict())
    markdown_path.write_text(build_markdown_report(report), encoding="utf-8")
    return raw_path, markdown_path


def rebuild_markdown_report(raw_report_path: Path, markdown_dir: Path) -> Path:
    payload = read_json(raw_report_path)
    report = _report_from_dict(payload)
    markdown_path = markdown_dir / f"{raw_report_path.stem}.md"
    markdown_path.write_text(build_markdown_report(report), encoding="utf-8")
    return markdown_path


def build_markdown_report(report: QAReport) -> str:
    summary = report.summary
    lines = [
        f"# Relatorio QA Automatizado — {report.project_name}",
        "",
        "## 1. Resumo Executivo",
        "",
        f"- Projeto: {report.project_name}",
        f"- URL testada: {report.app_url or 'nao configurada'}",
        f"- Data/hora inicio: {report.started_at}",
        f"- Data/hora fim: {report.finished_at}",
        f"- Status geral: {report.status}",
        f"- Total de testes: {summary.total_tests}",
        f"- Aprovados: {summary.passed}",
        f"- Falhas: {summary.failed}",
        f"- Alertas: {summary.warnings}",
        f"- Ignorados: {summary.skipped}",
        "",
        "## 2. Funcionalidades Testadas",
        "",
    ]

    if report.steps:
        for step in report.steps:
            lines.append(f"- {step.id} — {step.name} [{step.status}]")
    else:
        lines.append("- Nenhuma etapa foi executada.")

    lines.extend(["", "## 3. Testes Aprovados", ""])
    approved = [step for step in report.steps if step.status == "passed"]
    if approved:
        for step in approved:
            lines.append(f"- {step.id} — {step.name}")
    else:
        lines.append("- Nenhum teste aprovado.")

    lines.extend(["", "## 4. Alertas Encontrados", ""])
    warnings = [step for step in report.steps if step.status == "warning"]
    if warnings:
        for step in warnings:
            lines.append(f"- {step.id} — {step.name}: {step.actual_result or step.details}")
    else:
        lines.append("- Nenhum alerta registrado.")

    lines.extend(["", "## 5. Bugs Encontrados", ""])
    if report.bugs:
        for bug in report.bugs:
            lines.extend(
                [
                    f"### {bug.id} — {bug.title}",
                    "",
                    f"- Severidade: {bug.severity}",
                    f"- Tela/URL: {bug.screen_url or 'nao informado'}",
                    f"- Acao executada: {bug.action or 'nao informado'}",
                    f"- Resultado esperado: {bug.expected_result or 'nao informado'}",
                    f"- Resultado obtido: {bug.actual_result or 'nao informado'}",
                    f"- Evidencia: {', '.join(bug.evidence) if bug.evidence else 'nenhuma'}",
                    f"- Log tecnico: {' | '.join(bug.technical_log) if bug.technical_log else 'nenhum'}",
                    f"- Possivel causa: {bug.possible_cause or 'investigar'}",
                    f"- Recomendacao de correcao: {bug.recommendation or 'corrigir com o menor impacto possivel'}",
                    "",
                ]
            )
    else:
        lines.append("- Nenhum bug formal foi registrado.")

    lines.extend(["", "## 6. Logs Tecnicos", ""])
    lines.extend(_build_log_lines(report))

    lines.extend(["", "## 7. Evidencias Geradas", ""])
    if report.screenshots:
        for screenshot in report.screenshots:
            lines.append(f"- Screenshot: {screenshot}")
    if report.videos:
        for video in report.videos:
            lines.append(f"- Video: {video}")
    if report.trace:
        lines.append(f"- Trace: {report.trace}")
    if not report.screenshots and not report.videos and not report.trace:
        lines.append("- Nenhuma evidencia gerada.")

    lines.extend(
        [
            "",
            "## 8. Prompt Tecnico Para IA Dev",
            "",
            "```text",
            report.ai_dev_prompt,
            "```",
        ]
    )
    return "\n".join(lines) + "\n"


def _build_summary(steps: list[StepResult]) -> Summary:
    summary = Summary(total_tests=len(steps))
    for step in steps:
        if step.status == "passed":
            summary.passed += 1
        elif step.status == "failed":
            summary.failed += 1
        elif step.status == "warning":
            summary.warnings += 1
        elif step.status == "skipped":
            summary.skipped += 1
    return summary


def _build_bugs(report: QAReport) -> list[BugEntry]:
    bugs: list[BugEntry] = []

    for index, step in enumerate(report.steps, start=1):
        if step.status != "failed":
            continue
        bugs.append(
            BugEntry(
                id=f"BUG-{index:03d}",
                title=step.name,
                severity=step.severity,
                screen_url=step.url,
                action=step.name,
                expected_result=step.expected_result,
                actual_result=step.actual_result or step.details,
                evidence=step.evidence,
                technical_log=step.logs,
                possible_cause="Falha observada durante execucao automatizada.",
                recommendation="Investigar o fluxo, validar logs e corrigir a causa raiz sem quebrar funcionalidades existentes.",
                source="step_failure",
            )
        )

    bug_index = len(bugs)
    for network_error in report.network_errors:
        bug_index += 1
        bugs.append(
            BugEntry(
                id=f"BUG-{bug_index:03d}",
                title=f"Resposta HTTP {network_error.status}",
                severity=_severity_for_http_status(network_error.status),
                screen_url=network_error.url,
                action="Carregamento de recurso ou pagina",
                expected_result="A requisicao deveria responder com status 2xx ou 3xx.",
                actual_result=f"Resposta HTTP {network_error.status} ({network_error.status_text}) para {network_error.url}",
                technical_log=[
                    f"method={network_error.method}",
                    f"resource_type={network_error.resource_type}",
                ],
                possible_cause="Endpoint indisponivel, rota invalida, permissao insuficiente ou erro no servidor.",
                recommendation="Verificar a rota, autenticacao, regras de acesso e logs do backend.",
                source="network_error",
            )
        )

    for page_error in report.page_errors:
        bug_index += 1
        bugs.append(
            BugEntry(
                id=f"BUG-{bug_index:03d}",
                title="Erro JavaScript em runtime",
                severity="high",
                action="Execucao do frontend",
                expected_result="Nao devem ocorrer erros JavaScript nao tratados.",
                actual_result=page_error.message,
                technical_log=[page_error.message],
                possible_cause="Excecao nao tratada, dependencia ausente ou estado invalido do frontend.",
                recommendation="Reproduzir o erro, revisar stack trace e proteger o fluxo com tratamento adequado.",
                source="page_error",
            )
        )

    for failed_request in report.failed_requests:
        bug_index += 1
        bugs.append(
            BugEntry(
                id=f"BUG-{bug_index:03d}",
                title="Request com falha de transporte",
                severity="medium",
                screen_url=failed_request.url,
                action="Execucao de request do frontend",
                expected_result="A request deve completar sem falha de rede.",
                actual_result=f"Falha ao chamar {failed_request.url}: {failed_request.failure_text}",
                technical_log=[
                    f"method={failed_request.method}",
                    f"resource_type={failed_request.resource_type}",
                    failed_request.failure_text,
                ],
                possible_cause="Falha de rede, CORS, timeout, DNS ou recurso indisponivel.",
                recommendation="Revisar endpoint, conectividade, CORS e estrategia de retry.",
                source="request_failed",
            )
        )

    return bugs


def _severity_for_http_status(status: int) -> str:
    if status >= 500:
        return "critical"
    if status in {401, 403}:
        return "high"
    if status == 404:
        return "medium"
    return "low"


def _resolve_overall_status(report: QAReport) -> str:
    if report.summary.failed > 0 or report.page_errors or report.network_errors:
        return "failed"
    if report.summary.warnings > 0 or report.failed_requests:
        return "warning"
    return "passed"


def _build_log_lines(report: QAReport) -> list[str]:
    lines: list[str] = []

    if report.console_logs:
        lines.append("### Console Logs")
        lines.append("")
        for item in report.console_logs:
            location = f" | {item.location}" if item.location else ""
            lines.append(f"- [{item.level}] {item.text}{location}")
        lines.append("")

    if report.page_errors:
        lines.append("### Page Errors")
        lines.append("")
        for item in report.page_errors:
            lines.append(f"- {item.message}")
        lines.append("")

    if report.network_errors:
        lines.append("### Network Errors")
        lines.append("")
        for item in report.network_errors:
            lines.append(f"- {item.status} {item.status_text} | {item.method} | {item.url}")
        lines.append("")

    if report.failed_requests:
        lines.append("### Failed Requests")
        lines.append("")
        for item in report.failed_requests:
            lines.append(f"- {item.method} | {item.url} | {item.failure_text}")
        lines.append("")

    if not lines:
        lines.append("- Nenhum log tecnico relevante foi capturado.")

    return lines


def _report_from_dict(payload: dict) -> QAReport:
    report = QAReport(
        project_name=payload["project_name"],
        started_at=payload["started_at"],
        finished_at=payload.get("finished_at", ""),
        app_url=payload.get("app_url", ""),
        status=payload.get("status", "unknown"),
        metadata=payload.get("metadata", {}),
        ai_dev_prompt=payload.get("ai_dev_prompt", ""),
    )
    report.summary = Summary(**payload.get("summary", {}))
    report.steps = [StepResult(**item) for item in payload.get("steps", [])]
    report.console_logs = [ConsoleLogEntry(**item) for item in payload.get("console_logs", [])]
    report.page_errors = [PageErrorEntry(**item) for item in payload.get("page_errors", [])]
    report.network_errors = [NetworkErrorEntry(**item) for item in payload.get("network_errors", [])]
    report.failed_requests = [FailedRequestEntry(**item) for item in payload.get("failed_requests", [])]
    report.screenshots = payload.get("screenshots", [])
    report.videos = payload.get("videos", [])
    report.trace = payload.get("trace", "")
    report.bugs = [BugEntry(**item) for item in payload.get("bugs", [])]
    return report
