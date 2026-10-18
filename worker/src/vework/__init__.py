import os
import sys
from collections.abc import MutableMapping


def cap_onednn(platform: str, env: MutableMapping[str, str]) -> None:
    """Keeps oneDNN, torch's CPU kernels, off Intel's AMX on Windows, unless the environment
    already says how far it may go. On Intel CPUs with AMX (Xeon 8573C, on GitHub's Windows
    runners) the aligner's bfloat16 matmuls stop the process with an illegal instruction; the
    AVX-512 bfloat16 kernels below AMX run it. It has to be set before torch is first imported."""
    if platform == "win32":
        env.setdefault("ONEDNN_MAX_CPU_ISA", "AVX512_CORE_BF16")


cap_onednn(sys.platform, os.environ)
