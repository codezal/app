import { homeDir } from "@tauri-apps/api/path"
import { exists } from "@tauri-apps/plugin-fs"
import { resolveProgram, runShell, isWindows } from "@/lib/exec"

const RG_VERSION = "14.1.1"

export async function resolveRg(): Promise<string | null> {
  // 1. Sistem rg (cross-platform which — PATH + PATHEXT)
  const sys = await resolveProgram("rg")
  if (sys) return sys

  const home = await homeDir().catch(() => "")
  if (home) {
    const cached = `${home.replace(/[/\\]+$/, "")}/.codezal/bin/rg`
    if (await exists(cached)) return cached
  }

  if (await isWindows()) return null
  return downloadRg()
}

async function downloadRg(): Promise<string | null> {
  const script = `
set -e
ARCH=$(uname -m)
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
VERSION="${RG_VERSION}"
DEST="$HOME/.codezal/bin"
RG="$DEST/rg"

mkdir -p "$DEST"

if [ -x "$RG" ]; then echo "$RG"; exit 0; fi

if [ "$OS" = "darwin" ]; then
  if [ "$ARCH" = "arm64" ]; then
    TARGET="aarch64-apple-darwin"
  else
    TARGET="x86_64-apple-darwin"
  fi
elif [ "$OS" = "linux" ]; then
  if [ "$ARCH" = "aarch64" ]; then
    TARGET="aarch64-unknown-linux-gnu"
  else
    TARGET="x86_64-unknown-linux-musl"
  fi
else
  exit 1
fi

URL="https://github.com/BurntSushi/ripgrep/releases/download/$VERSION/ripgrep-$VERSION-$TARGET.tar.gz"
TMP=$(mktemp -d)
curl -sSfL "$URL" -o "$TMP/rg.tar.gz"
tar xzf "$TMP/rg.tar.gz" -C "$TMP"
mv "$TMP/ripgrep-$VERSION-$TARGET/rg" "$RG"
chmod +x "$RG"
rm -rf "$TMP"
echo "$RG"
`
  const r = await runShell(script)
  return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null
}
