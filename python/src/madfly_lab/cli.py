"""Console-script entry points declared in pyproject.toml."""

import runpy
import sys
from pathlib import Path


def build_pack_main() -> int:
    """`madfly-build-pack` -- thin wrapper so scripts/build_pack.py stays the
    single implementation (it is also the documented `python scripts/...` path).
    """
    script = Path(__file__).resolve().parents[2] / "scripts" / "build_pack.py"
    if not script.exists():
        print(f"build_pack.py not found at {script}", file=sys.stderr)
        return 1
    runpy.run_path(str(script), run_name="__main__")
    return 0
