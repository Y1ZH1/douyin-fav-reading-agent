# -*- coding: utf-8 -*-
"""向量的「一键安装」：建独立 venv、装 sentence-transformers、下模型、验一遍。

为什么要独立 venv 而不是直接 pip install：

- 这个 Flask 进程用的可能是系统 Python 或 cap-backend 的 venv，往里塞
  torch 级别的依赖容易把转写环境搞坏。
- 独立 venv 放在 `state/venv-vector/`，装坏了删目录即可，转写完全不受影响。
- 装完后 `retrieve._activate_local_venv()` 会把它的 site-packages 挂进
  sys.path，所以**不用换解释器重启**，下一次检索就能用上。

国内网络默认走清华 pip 源 + hf-mirror，可用环境变量覆盖：
`DOUYIN_PIP_INDEX` / `HF_ENDPOINT`。

每一步都能停：worker 是「流式子进程输出」，app.py 把它包成 job，
用户点停止就 terminate 子进程。
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import retrieve

VENV_DIR = retrieve.VENV_DIR
MODEL_DIR = retrieve.MODEL_DIR
STATE_DIR = retrieve.STATE_DIR


def venv_python() -> Path:
    if os.name == "nt":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def model_target(name: str | None = None) -> Path:
    name = name or os.environ.get("DOUYIN_EMBED_MODEL") or retrieve.DEFAULT_MODEL
    return MODEL_DIR / name.replace("/", "__")


def _run(args: list[str], log, env: dict | None = None, cwd: Path | None = None) -> int:
    """跑子进程并把输出逐行喂给 log()。返回退出码。"""
    merged = os.environ.copy()
    merged.update(env or {})
    merged.setdefault("PYTHONIOENCODING", "utf-8")
    log("$ " + " ".join(str(a) for a in args))
    try:
        p = subprocess.Popen(
            [str(a) for a in args],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            errors="replace",
            env=merged,
            cwd=str(cwd) if cwd else None,
        )
    except OSError as exc:
        log(f"启动失败：{exc}")
        return 1
    try:
        assert p.stdout is not None
        for line in p.stdout:
            line = line.rstrip()
            if line:
                log(line)
        p.wait()
    except Exception as exc:  # noqa: BLE001
        log(f"读取输出失败：{exc}")
        try:
            p.terminate()
        except Exception:  # noqa: BLE001
            pass
        return 1
    return p.returncode or 0


def ensure_venv(log) -> Path:
    py = venv_python()
    if py.is_file():
        log(f"复用一个 venv：{VENV_DIR}")
        return py
    VENV_DIR.parent.mkdir(parents=True, exist_ok=True)
    code = _run([sys.executable, "-m", "venv", str(VENV_DIR)], log)
    if code != 0 or not py.is_file():
        raise RuntimeError("创建 venv 失败（可能是 uvenv/virtualenv 不可用）")
    log(f"venv 已创建：{VENV_DIR}")
    return py


def install(log=lambda m: None) -> dict:
    """完整安装流程。返回结果摘要；失败时 raise。"""
    log(f"pip 源：{retrieve.PIP_INDEX}")
    log(f"HF 镜像：{retrieve.HF_ENDPOINT}")
    py = ensure_venv(log)

    log("① 升级 pip / setuptools / wheel …")
    _run([py, "-m", "pip", "install", "-q", "-U", "pip", "setuptools", "wheel",
          "-i", retrieve.PIP_INDEX], log)

    log("② 安装 sentence-transformers（含 torch，体积较大，可能要几分钟）…")
    code = _run([py, "-m", "pip", "install", "-U", "sentence-transformers",
                 "-i", retrieve.PIP_INDEX], log)
    if code != 0:
        raise RuntimeError("安装 sentence-transformers 失败，见上方日志")

    log("③ 下载中文句向量模型（bge-small-zh-v1.5，约 100MB）…")
    name = os.environ.get("DOUYIN_EMBED_MODEL") or retrieve.DEFAULT_MODEL
    target = model_target(name)
    snippet = (
        "import os\n"
        "from huggingface_hub import snapshot_download\n"
        f"snapshot_download(repo_id={name!r}, local_dir={str(target)!r},\n"
        "                  allow_patterns=['*.json','*.txt','*.bin','*.model','*.safetensors'])\n"
        "print('MODEL_OK')\n"
    )
    code = _run([py, "-c", snippet], log,
                env={"HF_ENDPOINT": retrieve.HF_ENDPOINT, "HF_HUB_DISABLE_TELEMETRY": "1"})
    if code != 0 or not target.is_dir():
        log("模型下载失败。检索不受影响，仍走全文检索；"
            "也可以手动把模型放到 " + str(target))
    else:
        log(f"模型已就位：{target}")

    log("④ 在当前进程里生效并自检 …")
    retrieve.refresh_paths()
    ok = False
    try:
        ok = retrieve.embed_available()
    except Exception as exc:  # noqa: BLE001
        log(f"自检异常：{exc}")
    log("自检结果：" + ("向量可用 ✓" if ok else "向量仍不可用，检索继续走全文（FTS）"))

    return {
        "ok": ok,
        "venv": str(VENV_DIR),
        "model": name,
        "model_dir": str(target),
        "model_cached": target.is_dir(),
        "status": retrieve.vector_status(),
    }


def uninstall(log=lambda m: None) -> dict:
    """删掉 venv 与本地模型，退回纯全文检索。"""
    import shutil

    removed = []
    for d in (VENV_DIR, model_target()):
        if d.is_dir():
            shutil.rmtree(d, ignore_errors=True)
            removed.append(str(d))
            log(f"已删除 {d}")
    retrieve.refresh_paths()
    return {"ok": True, "removed": removed, "status": retrieve.vector_status()}
