#!/usr/bin/env python3
"""把 dist/<plugin_id> 打成 Mattermost 插件包（.tar.gz）。

之所以不用裸 tar：在 Windows / macOS 等不严格记录 POSIX 权限位的文件系统上，
`chmod 0755` 对 tar 无效，打出来的插件二进制是 0644，Mattermost 解包后无法 exec，
服务端会报 permission denied。这里显式给每个条目指定权限位，保证跨平台一致。

用法：
    python scripts/pack.py <源目录> <输出 tar.gz>
"""
import os
import sys
import tarfile

EXECUTABLE_PARTS = ("server/dist/",)  # 这些目录下的文件需要可执行位


def mode_for(relpath: str) -> int:
    rel = relpath.replace("\\", "/")
    for part in EXECUTABLE_PARTS:
        if part in rel:
            return 0o755
    return 0o644


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2

    src, out = sys.argv[1], sys.argv[2]
    if not os.path.isdir(src):
        print(f"源目录不存在: {src}")
        return 1

    base = os.path.basename(os.path.normpath(src))

    def normalize(info: tarfile.TarInfo) -> tarfile.TarInfo:
        info.mode = mode_for(info.name)
        if info.isdir():
            info.mode = 0o755
        info.uid = info.gid = 0
        info.uname = info.gname = ""
        return info

    with tarfile.open(out, "w:gz") as tf:
        tf.add(src, arcname=base, filter=normalize)

    with tarfile.open(out, "r:gz") as tf:
        for info in tf.getmembers():
            print(f"  {info.mode:04o}  {info.size:>10}  {info.name}")

    print(f"packed: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
