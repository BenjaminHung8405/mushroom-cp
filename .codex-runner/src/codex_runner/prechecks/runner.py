from __future__ import annotations
import subprocess
from pathlib import Path
from codex_runner.models import CommandResult

class PrecheckRunner:
    def __init__(self, commands: list[list[str]]): self.commands = commands
    def run(self, cwd: Path, dry_run: bool = False) -> list[CommandResult]:
        results = []
        for command in self.commands:
            if dry_run:
                print("[dry-run precheck]", " ".join(command)); results.append(CommandResult(command, 0, "", "")); continue
            try:
                p = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
                print(p.stdout, end=""); print(p.stderr, end="")
                results.append(CommandResult(command, p.returncode, p.stdout, p.stderr))
            except OSError as exc: results.append(CommandResult(command, 127, "", str(exc)))
        return results
