from __future__ import annotations
import os
import selectors
import subprocess
import time
from pathlib import Path
from codex_runner.models import CommandResult

class CodexExecutor:
    def __init__(self, executable: str = "codex", args: list[str] | None = None, timeout: int = 3600):
        self.executable, self.args, self.timeout = executable, args or ["exec"], timeout

    def run(self, prompt: str, cwd: Path, dry_run: bool = False) -> CommandResult:
        command = [self.executable, *self.args, prompt]
        if dry_run:
            print("[dry-run]", " ".join(command))
            return CommandResult(command, 0, "", "")
        try:
            process = subprocess.Popen(command, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, bufsize=1, start_new_session=True)
        except OSError as exc:
            return CommandResult(command, 127, "", str(exc))
        selector = selectors.DefaultSelector()
        assert process.stdout and process.stderr
        selector.register(process.stdout, selectors.EVENT_READ, data="stdout")
        selector.register(process.stderr, selectors.EVENT_READ, data="stderr")
        out, err, deadline = [], [], time.monotonic() + self.timeout
        while selector.get_map():
            if time.monotonic() >= deadline:
                process.kill(); return CommandResult(command, -1, "".join(out), "".join(err), True)
            for key, _ in selector.select(timeout=0.2):
                line = key.fileobj.readline()
                if not line:
                    selector.unregister(key.fileobj); continue
                (out if key.data == "stdout" else err).append(line)
                print(line, end="")
        return CommandResult(command, process.wait(), "".join(out), "".join(err))
