from __future__ import annotations
import re
from pathlib import Path
from codex_runner.models import Task, TaskStatus

class ProgressFormatError(ValueError):
    pass

_STATUS = {s.value: s for s in TaskStatus}
_ROW = re.compile(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\[x\] Done|\[ \] Pending|\[ \] In Progress|\[ \] QA Review)\s*\|\s*(.*?)\s*\|\s*$")
_ID = re.compile(r"^[A-Z]+[0-9]+$")

class ProgressParser:
    def __init__(self, path: Path):
        self.path = path

    def read(self) -> str:
        if not self.path.exists():
            raise FileNotFoundError(f"PROGRESS.md không tồn tại: {self.path}")
        try:
            text = self.path.read_text(encoding="utf-8")
        except OSError as exc:
            raise OSError(f"Không thể đọc PROGRESS.md: {exc}") from exc
        if not text.strip():
            raise ProgressFormatError("PROGRESS.md rỗng")
        return text

    def parse(self) -> list[Task]:
        tasks: list[Task] = []
        for number, line in enumerate(self.read().splitlines(), 1):
            match = _ROW.match(line)
            if not match:
                continue
            task_id, description, status_text, note = match.groups()
            if not _ID.fullmatch(task_id.strip()):
                raise ProgressFormatError(f"Task ID không hợp lệ ở dòng {number}: {task_id}")
            tasks.append(Task(task_id.strip(), description.strip(), _STATUS[status_text], note.strip(), number))
        if not tasks:
            raise ProgressFormatError("Không tìm thấy dòng task hợp lệ trong PROGRESS.md")
        ids = [task.task_id for task in tasks]
        if len(ids) != len(set(ids)):
            raise ProgressFormatError("Task ID bị trùng")
        return tasks

    def first_pending(self) -> Task | None:
        return next((t for t in self.parse() if t.status is TaskStatus.PENDING), None)

    def find(self, task_id: str) -> Task:
        matches = [t for t in self.parse() if t.task_id == task_id]
        if not matches:
            raise ProgressFormatError(f"Không tìm thấy Task {task_id}")
        return matches[0]
