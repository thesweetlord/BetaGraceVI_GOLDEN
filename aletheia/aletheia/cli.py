"""Rich + Typer CLI — the private surface for the user.

Commands:
  aletheia learn "<topic>"          fetch+ingest from all sources
  aletheia ask "<question>"         retrieve cited evidence
  aletheia status                   counts, gaps, graph stats
  aletheia gaps                     list scheduled re-fetch topics
  aletheia tend                     re-fetch every scheduled gap topic
  aletheia serve                    run the FastAPI service (port 8765)
"""

from __future__ import annotations

import asyncio

import typer
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from . import config, feedback, knowledge_graph, learner, query, vector_store

app = typer.Typer(
    add_completion=False,
    help="Aletheia — a self-improving, citation-honest knowledge engine.",
    no_args_is_help=True,
)
console = Console()


_LABEL_STYLE = {
    "established": "bold green",
    "tentative": "yellow",
    "uncertain": "magenta",
    "unknown": "red",
}


def _label(text: str) -> Text:
    return Text(text, style=_LABEL_STYLE.get(text, "white"))


@app.command()
def learn(
    topic: str = typer.Argument(..., help="Topic / search query to learn about."),
    limit: int = typer.Option(3, help="Items per source."),
):
    """Fetch from all sources, rectify, embed, persist."""
    console.print(Panel.fit(f"[bold]Learning:[/bold] {topic}", style="cyan"))
    summary = asyncio.run(learner.learn(topic, limit_per_source=limit))
    table = Table(title="Ingest summary", show_header=True, header_style="bold")
    for k, v in summary.items():
        if k == "contradictions":
            continue
        table.add_row(k, str(v))
    console.print(table)
    if summary.get("contradictions"):
        console.print(
            Panel(
                "\n".join(f"• {c}" for c in summary["contradictions"]),
                title="[bold red]Contradiction signals[/bold red]",
                style="red",
            )
        )


@app.command()
def ask(
    question: str = typer.Argument(..., help="Question to answer with citations."),
    k: int = typer.Option(6, help="Top-k evidence chunks to return."),
):
    """Retrieve cited evidence (no fabricated prose answers)."""
    result = query.ask(question, k=k)
    status = result["answer_status"]
    console.print(Panel.fit(
        Text.assemble(("Question: ", "bold"), question, "\n",
                      ("Status:   ", "bold"), _label(status)),
        style="cyan",
    ))
    if not result["evidence"]:
        console.print("[red]No evidence found. Try `aletheia learn \"<topic>\"` first.[/red]")
        return
    for i, ev in enumerate(result["evidence"], 1):
        title = ev["title"] or "(untitled)"
        header = Text.assemble(
            (f"[{i}] ", "dim"),
            (f"{ev['source']}", "bold cyan"),
            (" · ", "dim"),
            (title, "bold"),
            (" · sim=", "dim"),
            (f"{ev['similarity']:.2f}", "white"),
            (" · conf=", "dim"),
            (f"{ev['confidence']:.2f} ", "white"),
            _label(ev["label"]),
        )
        body_lines = [ev["text"][:600] + ("…" if len(ev["text"]) > 600 else "")]
        if ev["supporting_sources"]:
            body_lines.append(
                f"[dim]supporting sources:[/dim] {', '.join(ev['supporting_sources'])}"
            )
        if ev["source_url"]:
            body_lines.append(f"[dim]url:[/dim] {ev['source_url']}")
        if ev["contradiction_flags"]:
            body_lines.append(
                "[red]contradiction flags:[/red] "
                + " | ".join(ev["contradiction_flags"])
            )
        console.print(Panel("\n".join(body_lines), title=header, border_style="dim"))

    if result["related_entities"]:
        rel = ", ".join(f"{e} ({w:.0f})" for e, w, _ in result["related_entities"])
        console.print(Panel(rel, title="related entities", border_style="dim"))


@app.command()
def status():
    """Print store / graph / gap counts."""
    table = Table(title="Aletheia status", show_header=True, header_style="bold")
    table.add_column("metric"); table.add_column("value")
    table.add_row("vector store chunks", str(vector_store.count()))
    g = knowledge_graph.stats()
    table.add_row("graph nodes", str(g["nodes"]))
    table.add_row("graph edges", str(g["edges"]))
    table.add_row("scheduled gaps", str(len(feedback.scheduled_gaps())))
    table.add_row("data dir", str(config.DATA_DIR))
    console.print(table)


@app.command()
def gaps():
    """List topics flagged for re-fetch by the feedback loop."""
    g = feedback.scheduled_gaps()
    if not g:
        console.print("[green]No scheduled gaps. The library is keeping up.[/green]")
        return
    table = Table(title="Scheduled gaps", show_header=True, header_style="bold")
    table.add_column("query")
    for q in g:
        table.add_row(q)
    console.print(table)


@app.command()
def tend(limit: int = typer.Option(3, help="Items per source per topic.")):
    """Re-fetch every scheduled gap topic. The self-improvement loop."""
    topics = feedback.scheduled_gaps()
    if not topics:
        console.print("[green]Nothing to tend.[/green]"); return
    for t in topics:
        console.print(Panel.fit(f"[bold]Tending:[/bold] {t}", style="green"))
        s = asyncio.run(learner.learn(t, limit_per_source=limit))
        console.print(s)
        feedback.clear_topic(t)


@app.command()
def serve(
    host: str = typer.Option("0.0.0.0"),
    port: int = typer.Option(8000),
):
    """Run the FastAPI service."""
    import uvicorn
    uvicorn.run("aletheia.api:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    app()
