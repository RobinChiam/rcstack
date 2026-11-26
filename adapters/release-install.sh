#!/usr/bin/env bash
# Standalone release installer for rcstack-beta.
# Template source: adapters/release-install.sh (rendered by adapters/build-release.sh).
#
#   bash install.sh [--dry-run] [--home <dir>] [--rcstack-home <dir>]
#
# Downloads the pinned GitHub Release archive over HTTPS into a private temporary directory,
# verifies its SHA-256 digest before extracting or executing anything from the archive, and
# delegates promotion to the unpacked adapters/install.sh with verified release metadata.
set -euo pipefail

RELEASE_VERSION="__RCSTACK_VERSION__"
RELEASE_TAG="__RCSTACK_TAG__"
RELEASE_COMMIT="__RCSTACK_COMMIT__"
ARCHIVE_NAME="__RCSTACK_ARCHIVE_NAME__"
ARCHIVE_URL="__RCSTACK_ARCHIVE_URL__"
ARCHIVE_SHA256="__RCSTACK_ARCHIVE_SHA256__"

usage() {
  cat <<'USAGE'
Usage: bash install.sh [--dry-run] [--home <dir>] [--rcstack-home <dir>]

  --dry-run            print the release download and install plan; write no temp files and make no requests
  --home <dir>         home directory holding the harness skill directories (default: $HOME)
  --rcstack-home <dir> installed runtime home (default: <home>/.rcstack)
  -h, --help           show this help
USAGE
}

say() { printf '%s\n' "$*"; }
die() {
  printf 'release-install: error: %s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------- arguments
DRY_RUN=0
HOME_DIR="${HOME:-}"
RC_HOME=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --home)
      [ "$#" -ge 2 ] || die "--home needs a directory"
      HOME_DIR="$2"
      shift
      ;;
    --home=*) HOME_DIR="${1#*=}" ;;
    --rcstack-home)
      [ "$#" -ge 2 ] || die "--rcstack-home needs a directory"
      RC_HOME="$2"
      shift
      ;;
    --rcstack-home=*) RC_HOME="${1#*=}" ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      die "unknown argument: $1"
      ;;
  esac
  shift
done

# ---------------------------------------------------------------------------- embedded metadata checks
if [[ "$RELEASE_VERSION" == __* ]] || [[ "$RELEASE_COMMIT" == __* ]] || [[ "$ARCHIVE_SHA256" == __* ]]; then
  die "this file is an unrendered release installer template; generate a release installer with adapters/build-release.sh"
fi
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid embedded release version: $RELEASE_VERSION"
[[ "$RELEASE_TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid embedded release tag: $RELEASE_TAG"
[[ "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "invalid embedded release commit SHA: $RELEASE_COMMIT"
[[ "$ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "invalid embedded archive SHA-256: $ARCHIVE_SHA256"
[[ "$ARCHIVE_NAME" =~ ^rcstack-[0-9]+\.[0-9]+\.[0-9]+\.tar\.gz$ ]] || die "invalid embedded archive name: $ARCHIVE_NAME"
[[ "$ARCHIVE_URL" =~ ^https://[^[:space:]]+$ ]] || die "refusing non-HTTPS or malformed archive URL: $ARCHIVE_URL"

[ -n "$HOME_DIR" ] || die "no home directory: set \$HOME or pass --home <dir>"
case "$HOME_DIR$RC_HOME" in
  *$'\n'*) die "paths must not contain a newline" ;;
esac
display_rc_home="${RC_HOME:-$HOME_DIR/.rcstack}"

# ---------------------------------------------------------------------------- read-only dry run
if [ "$DRY_RUN" -eq 1 ]; then
  say "rcstack-beta $RELEASE_VERSION standalone release installer"
  say "  release tag:   $RELEASE_TAG"
  say "  commit:        $RELEASE_COMMIT"
  say "  archive URL:   $ARCHIVE_URL"
  say "  expected sha:  $ARCHIVE_SHA256"
  say "  rcstack home:  $display_rc_home"
  say "  harness home:  $HOME_DIR"
  say "  mode:          DRY RUN: nothing will be downloaded, created, changed, or deleted"
  say ""
  say "[dry-run] would download $ARCHIVE_URL over HTTPS into a private temporary directory"
  say "[dry-run] would verify SHA-256 of $ARCHIVE_NAME equals $ARCHIVE_SHA256 before extracting"
  say "[dry-run] would extract rcstack-$RELEASE_VERSION/ and run adapters/install.sh --from-release --release-commit $RELEASE_COMMIT --home $HOME_DIR --rcstack-home $display_rc_home"
  say "[dry-run] would remove the temporary directory on exit"
  say ""
  say "release-install: dry run complete: no network requests, temporary files, or destination checks were performed; nothing changed"
  exit 0
fi

# ---------------------------------------------------------------------------- preflight (read-only)
[ -d "$HOME_DIR" ] || die "home directory does not exist: $HOME_DIR"
for tool in curl mktemp tar chmod rm mkdir bash tr; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  die "required command not found: sha256sum, shasum, or node"
fi

sha256_file() {
  local sum="" _rest=""
  if command -v sha256sum >/dev/null 2>&1; then
    read -r sum _rest < <(sha256sum "$1")
    printf '%s\n' "$sum"
  elif command -v shasum >/dev/null 2>&1; then
    read -r sum _rest < <(shasum -a 256 "$1")
    printf '%s\n' "$sum"
  else
    node -e 'const fs=require("node:fs"),c=require("node:crypto");console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$1"
  fi
}

# ---------------------------------------------------------------------------- private temp workspace
WORKDIR=""
cleanup() {
  if [ -n "$WORKDIR" ] && [ -d "$WORKDIR" ]; then
    chmod -R u+w "$WORKDIR" 2>/dev/null || true
    rm -rf "$WORKDIR"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

old_umask="$(umask)"
umask 077
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rcstack-release.XXXXXX")"
chmod 700 "$WORKDIR"
umask "$old_umask"

archive_path="$WORKDIR/$ARCHIVE_NAME"

# ---------------------------------------------------------------------------- download + verify digest
say "release-install: downloading $ARCHIVE_URL"
curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
  --output "$archive_path" "$ARCHIVE_URL" ||
  die "failed to download $ARCHIVE_URL; nothing was changed"

[ -f "$archive_path" ] || die "downloaded archive is missing; nothing was changed"
actual_sha256="$(sha256_file "$archive_path" | tr '[:upper:]' '[:lower:]')"
if [ "$actual_sha256" != "$ARCHIVE_SHA256" ]; then
  die "SHA-256 mismatch for $ARCHIVE_NAME (expected $ARCHIVE_SHA256, got ${actual_sha256:-empty}); refusing to extract or install. Nothing was changed"
fi
say "release-install: verified SHA-256 ($actual_sha256)"

# ---------------------------------------------------------------------------- extract + promote
extract_dir="$WORKDIR/src"
mkdir -p "$extract_dir"
tar -xzf "$archive_path" -C "$extract_dir"

unpacked_root="$extract_dir/rcstack-$RELEASE_VERSION"
[ -d "$unpacked_root" ] && [ ! -L "$unpacked_root" ] ||
  die "archive did not extract expected directory rcstack-$RELEASE_VERSION; nothing was changed"
[ -f "$unpacked_root/adapters/install.sh" ] && [ ! -L "$unpacked_root/adapters/install.sh" ] ||
  die "archive is missing adapters/install.sh; nothing was changed"

install_args=(--from-release --release-commit "$RELEASE_COMMIT" --home "$HOME_DIR")
if [ -n "$RC_HOME" ]; then
  install_args+=(--rcstack-home "$RC_HOME")
fi

bash "$unpacked_root/adapters/install.sh" "${install_args[@]}"
