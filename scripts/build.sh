#!/usr/bin/env bash
#
# 不依赖 GNU make 的打包脚本。Windows 下用 Git Bash 执行：
#   ./scripts/build.sh
# 可选参数：
#   ./scripts/build.sh linux-arm64    只构建指定 GOOS-GOARCH
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PLUGIN_ID="$(node -p "require('./plugin.json').id")"
PLUGIN_VERSION="$(node -p "require('./plugin.json').version")"
BUNDLE_NAME="${PLUGIN_ID}-${PLUGIN_VERSION}.tar.gz"

# 1) 生成 server/manifest.go 与 webapp/src/manifest.ts（需要 go，缺失时跳过）
if command -v go >/dev/null 2>&1; then
    # 构建工具必须在宿主机上运行，忽略 `go env -w GOOS=...` 持久化设置的交叉编译目标
    HOST_GOOS="$(go env GOHOSTOS)"
    HOST_GOARCH="$(go env GOHOSTARCH)"
    mkdir -p build/bin
    rm -f build/bin/manifest build/bin/manifest.exe
    (cd build/manifest && env GOOS="$HOST_GOOS" GOARCH="$HOST_GOARCH" go build -o ../bin/manifest .)
    ./build/bin/manifest check
    ./build/bin/manifest apply
fi

# 2) 构建服务端
mkdir -p server/dist
rm -f server/dist/*
TARGETS=("${1:-linux-amd64}")
if [ $# -eq 0 ]; then
    TARGETS=("linux-amd64" "linux-arm64")
fi
for target in "${TARGETS[@]}"; do
    GOOS="${target%-*}"
    GOARCH="${target##*-}"
    suffix=".exe"
    [ "$GOOS" = "windows" ] || suffix=""
    echo "building server -> $GOOS/$GOARCH"
    (cd server && env CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -o "dist/plugin-${target}${suffix}" .)
done

# 3) 构建前端
if [ ! -d webapp/node_modules ]; then
    (cd webapp && npm install --no-audit --no-fund)
fi
(cd webapp && npm run build)

# 4) 组装 dist
# 注意：plugin.json 里声明的是 server/dist/plugin-<os>-<arch>，
# 这里的目录层级必须严格一致，否则服务端会报
# "unable to generate plugin checksum: ... no such file or directory"
rm -rf "dist/${PLUGIN_ID}"
mkdir -p "dist/${PLUGIN_ID}/server/dist" "dist/${PLUGIN_ID}/webapp/dist"
cp plugin.json "dist/${PLUGIN_ID}/"
cp -r assets "dist/${PLUGIN_ID}/"
for f in server/dist/*; do
    [ -e "$f" ] || continue
    cp "$f" "dist/${PLUGIN_ID}/server/dist/"
done

cp webapp/dist/main.js "dist/${PLUGIN_ID}/webapp/dist/main.js"

# Windows 上没有 POSIX 可执行位，裸 tar 会记录 0644，Mattermost 解包后 exec 不了。
# 用 pack.py 显式指定权限位（二进制 0755，其余 0644）；没有 python 时退化为 tar --mode。
PY=""
for c in "${PYTHON:-}" python3 python; do
    [ -n "$c" ] && command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }
done
if [ -n "$PY" ]; then
    "$PY" scripts/pack.py "dist/${PLUGIN_ID}" "dist/${BUNDLE_NAME}"
else
    echo "未找到 python，回退为 tar --mode=0755（包内所有文件均为 0755，不影响功能）"
    chmod 0755 dist/"${PLUGIN_ID}"/server/dist/* 2>/dev/null || true
    tar -czf "dist/${BUNDLE_NAME}" -C dist --mode=0755 "${PLUGIN_ID}"
fi

# 5) 自检：确认包内路径与 plugin.json 声明一致，且二进制具备可执行权限
ENTRIES="$(tar -tzvf "dist/${BUNDLE_NAME}")"
VERIFY_FAILED=0
for target in "${TARGETS[@]}"; do
    GOOS_T="${target%-*}"
    suffix=""
    [ "$GOOS_T" = "windows" ] && suffix=".exe"
    rel="server/dist/plugin-${target}${suffix}"
    line="$(printf '%s\n' "$ENTRIES" | grep -F " ${PLUGIN_ID}/${rel}" || true)"
    if [ -z "$line" ]; then
        echo "  [FAIL] 包内缺少 ${rel}"
        VERIFY_FAILED=1
        continue
    fi
    mode="$(printf '%s' "$line" | awk '{print $1}')"
    case "$mode" in
        -rwxr-xr-x) ;;
        *) echo "  [FAIL] ${rel} 权限为 ${mode}，应为 -rwxr-xr-x"; VERIFY_FAILED=1 ;;
    esac
    echo "  [OK] ${rel}  ${mode}"
done
if [ "$VERIFY_FAILED" -ne 0 ]; then
    echo "bundle verification FAILED"
    exit 1
fi

echo "plugin built at: dist/${BUNDLE_NAME}"
