from pathlib import Path

from codex_runner.models import TaskStatus
from codex_runner.parsers.progress import ProgressParser


def test_parses_backtick_wrapped_status(tmp_path: Path):
    progress = tmp_path / "PROGRESS.md"
    progress.write_text(
        "| Task ID | Mô tả | Status | Note |\n"
        "| :--- | :--- | :--- | :--- |\n"
        "| A1 | Implement auth | `[ ] Pending` | note |\n",
        encoding="utf-8",
    )

    tasks = ProgressParser(progress).parse()

    assert len(tasks) == 1
    assert tasks[0].task_id == "A1"
    assert tasks[0].status is TaskStatus.PENDING
