from __future__ import annotations

from .models import QAReport


def build_ai_dev_prompt(report: QAReport) -> str:
    lines = [
        "Voce e uma IA Dev atuando no projeto App 21 Dias.",
        "Analise os bugs encontrados pelo agente QA local.",
        "Corrija as falhas descritas abaixo mantendo compatibilidade com a estrutura atual do projeto.",
        "Nao remova funcionalidades existentes.",
        "Nao altere fluxos que ja funcionam.",
        "Priorize os bugs por severidade.",
        "Apos corrigir, explique quais arquivos foram alterados e por que.",
        "",
        f"Projeto: {report.project_name}",
        f"URL testada: {report.app_url}",
        f"Status geral do QA: {report.status}",
        "",
        "Bugs encontrados:",
    ]

    if not report.bugs:
        lines.append("- Nenhum bug formal foi registrado. Revise alertas e logs tecnicos para investigacoes preventivas.")
    else:
        for bug in report.bugs:
            lines.extend(
                [
                    f"- {bug.id} | severidade={bug.severity} | titulo={bug.title}",
                    f"  Tela/URL: {bug.screen_url or 'nao informado'}",
                    f"  Acao executada: {bug.action or 'nao informado'}",
                    f"  Esperado: {bug.expected_result or 'nao informado'}",
                    f"  Obtido: {bug.actual_result or 'nao informado'}",
                    f"  Evidencias: {', '.join(bug.evidence) if bug.evidence else 'nenhuma'}",
                    f"  Logs: {' | '.join(bug.technical_log) if bug.technical_log else 'nenhum'}",
                    f"  Possivel causa: {bug.possible_cause or 'investigar'}",
                    f"  Recomendacao: {bug.recommendation or 'corrigir com o menor impacto possivel'}",
                ]
            )

    lines.extend(
        [
            "",
            "Instrucao final:",
            "Corrija os problemas acima sem quebrar funcionalidades existentes e preserve a compatibilidade com a arquitetura atual do projeto.",
        ]
    )
    return "\n".join(lines)
