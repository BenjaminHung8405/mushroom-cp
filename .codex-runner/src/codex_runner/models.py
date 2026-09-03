from __future__ import annotations
from dataclasses import dataclass
from enum import Enum

class TaskStatus(str, Enum):
    PENDING = "[ ] Pending"
    IN_PROGRESS = "[ ] In Progress"
    QA_REVIEW = "[ ] QA Review"
    DONE = "[x] Done"

@dataclass(frozen=True)
class Task:
    task_id: str
    description: str
    status: TaskStatus
    note: str
    line_number: int

@dataclass(frozen=True)
class CommandResult:
    command: list[str]
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False

    @property
    def ok(self) -> bool:
        return self.returncode == 0 and not self.timed_out

@dataclass(frozen=True)
class Precheck:
    name: str
    command: list[str]
    timeout: int
