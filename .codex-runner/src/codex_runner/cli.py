from __future__ import annotations
import argparse, pathlib, sys
try:
    import yaml
except ImportError: yaml = None
from codex_runner.orchestrator import Orchestrator

def main() -> int:
    ap = argparse.ArgumentParser(description="Deterministic Codex CLI orchestrator")
    ap.add_argument("--plan", required=True); ap.add_argument("--task", default=None)
    ap.add_argument("--auto-approve", action="store_true"); ap.add_argument("--max-retries", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true"); ap.add_argument("--config", default=".codex-runner/config.yaml")
    args = ap.parse_args()
    if args.max_retries < 0: ap.error("--max-retries phải >= 0")
    root = pathlib.Path.cwd(); config = {}
    path = root / args.config
    if path.exists():
        if yaml is None: print("Lỗi: cần PyYAML để đọc config", file=sys.stderr); return 2
        config = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    try: return Orchestrator(root, args.plan, args.max_retries, args.auto_approve, args.dry_run, config).run(args.task)
    except (OSError, ValueError) as exc: print(f"Lỗi: {exc}", file=sys.stderr); return 2

if __name__ == "__main__": sys.exit(main())
