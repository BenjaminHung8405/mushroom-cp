from __future__ import annotations

import json
import os
import re
import signal
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from codex_runner.executors.codex_executor import CodexExecutor
from codex_runner.models import Precheck, TaskStatus
from codex_runner.parsers.progress import ProgressFormatError, ProgressParser
from codex_runner.prechecks.runner import PrecheckRunner


class Orchestrator:
    def __init__(self, root: Path, plan: str, max_retries: int, auto_approve: bool, dry_run: bool, config: dict):
        self.root, self.plan = root, plan
        self.auto_approve, self.dry_run = auto_approve, dry_run
        self.stop_requested = False
        runner = config.get("runner", {})
        self.max_retries = int(runner.get("max_retries", max_retries))
        self.lock_timeout = int(runner.get("lock_timeout_seconds", 10))
        self.poll_interval = float(runner.get("poll_interval_seconds", 1))
        if self.max_retries < 0 or self.lock_timeout <= 0 or self.poll_interval <= 0:
            raise ValueError("runner config không hợp lệ")
        progress_template = config.get("progress_file", ".ai/planning/{plan}/PROGRESS.md")
        progress = root / progress_template.format(plan=plan)
        self.parser = ProgressParser(progress)
        codex = config.get("codex", {})
        self.executor = CodexExecutor(
            codex.get("executable", "codex"),
            codex.get("args", ["exec"]),
            int(codex.get("timeout_seconds", 3600)),
        )
        self.precheck = PrecheckRunner(self._load_prechecks(config.get("precheck", {}).get("commands", [])))

    @staticmethod
    def _load_prechecks(raw: list) -> list[Precheck]:
        checks = []
        for index, item in enumerate(raw, 1):
            if isinstance(item, list):
                name, command, timeout = f"precheck-{index}", item, 300
            elif isinstance(item, dict):
                name = item.get("name", f"precheck-{index}")
                command = item.get("command")
                timeout = int(item.get("timeout_seconds", 300))
            else:
                raise ValueError(f"precheck {index} không hợp lệ")
            if (
                not isinstance(command, list)
                or not command
                or not all(isinstance(part, str) and part for part in command)
                or timeout <= 0
            ):
                raise ValueError(f"precheck {name} không hợp lệ")
            checks.append(Precheck(name, command, timeout))
        return checks

    @contextmanager
    def _lock(self):
        lock_path = self.root / ".codex-runner" / ".run.lock"
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        deadline = time.monotonic() + self.lock_timeout
        handle = None
        while handle is None:
            try:
                handle = lock_path.open("x", encoding="utf-8")
                handle.write(json.dumps({"pid": os.getpid(), "plan": self.plan}))
                handle.flush()
            except FileExistsError:
                if time.monotonic() >= deadline:
                    raise RuntimeError(f"Không lấy được lock trong {self.lock_timeout}s: {lock_path}")
                time.sleep(self.poll_interval)
        try:
            yield
        finally:
            handle.close()
            try:
                lock_path.unlink()
            except FileNotFoundError:
                pass

    def install_signals(self):
        def stop(signum, _frame):
            self.stop_requested = True
            print(f"\nNhận tín hiệu {signum}; dừng an toàn sau subprocess hiện tại.", file=sys.stderr)

        signal.signal(signal.SIGINT, stop)
        signal.signal(signal.SIGTERM, stop)

    def prompt(self, command: str) -> str:
        return (
            f"Bạn chỉ được làm việc trong Task được chỉ định. Đọc lại duy nhất các file tài liệu: "
            f".ai/planning/{self.plan}/PROGRESS.md, README.md và WALKTHROUGH_LOG.md. "
            f"Thực thi lệnh skill: {command}. Không dựa vào context của session trước."
        )

    def run(self, task_id: str | None = None) -> int:
        self.install_signals()
        with self._lock():
            while not self.stop_requested:
                task = self.parser.find(task_id) if task_id else self.parser.first_pending()
                if task is None:
                    print("Không còn Task Pending.")
                    return 0
                if task.status is not TaskStatus.PENDING:
                    raise ProgressFormatError(f"Task {task.task_id} phải ở Pending")
                result = self.executor.run(self.prompt(f"/task-exec {task.task_id}"), self.root, self.dry_run)
                if not result.ok:
                    return self._fail(f"task-exec thất bại: {result.stderr}")
                checks = self.precheck.run(self.root, self.dry_run)
                if any(not check.ok for check in checks):
                    return self._fail("Pre-check thất bại; không gọi audit")
                for attempt in range(self.max_retries + 1):
                    audit = self.executor.run(self.prompt(f"/task-audit {task.task_id}"), self.root, self.dry_run)
                    if audit.ok and not self._is_reject(audit.stdout + audit.stderr):
                        print(f"Task {task.task_id} đã được audit thành công.")
                        break
                    feedback = self._feedback(audit.stdout + audit.stderr)
                    if attempt >= self.max_retries:
                        return self._fail(
                            f"Circuit breaker: Task {task.task_id} thất bại sau {self.max_retries} lần sửa.\n{feedback}"
                        )
                    fix = self.executor.run(
                        self.prompt(f"/task-fix {task.task_id} {json.dumps(feedback, ensure_ascii=False)}"),
                        self.root,
                        self.dry_run,
                    )
                    if not fix.ok:
                        return self._fail(f"task-fix thất bại: {fix.stderr}")
                if task_id:
                    return 0
        return 130

    @staticmethod
    def _is_reject(text: str) -> bool:
        return bool(re.search(r"\b(REJECT|REJECTED|FAIL(?:ED)?)\b", text, re.I))

    @staticmethod
    def _feedback(text: str) -> str:
        marker = re.search(r"Lý do từ chối:(.*?)(?:Vui lòng chạy|$)", text, re.I | re.S)
        return (marker.group(1).strip() if marker else text.strip())[-12000:]

    @staticmethod
    def _fail(message: str) -> int:
        print(message, file=sys.stderr)
        return 1
