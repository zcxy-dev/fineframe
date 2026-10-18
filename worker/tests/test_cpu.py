import vework


def test_windows_keeps_onednn_off_amx_unless_told_otherwise():
    # Intel CPUs with AMX crash the aligner's bfloat16 on GitHub's Windows runners (#59).
    env = {}
    vework.cap_onednn("win32", env)
    assert env == {"ONEDNN_MAX_CPU_ISA": "AVX512_CORE_BF16"}
    env = {"ONEDNN_MAX_CPU_ISA": "AVX2"}
    vework.cap_onednn("win32", env)
    assert env == {"ONEDNN_MAX_CPU_ISA": "AVX2"}
    env = {}
    vework.cap_onednn("linux", env)
    assert env == {}
