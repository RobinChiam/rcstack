#!/usr/bin/env bash
# adapters/build-release.sh — reproducible packager for a verified tagged release.
#
#   bash adapters/build-release.sh --tag <vX.Y.Z> --out-dir <dir> [--repo <owner/repo>] [--source-repo <dir>]
#
# Packages verifier-required source paths from the exact commit pointed to by <tag> via
# `git archive` + deterministic `gzip -n`, validates the unpacked archive with its own shipped
# `scripts/verify.mjs`, and renders an independent executable `install.sh` pinned to the GitHub
# Release URL, expected SHA-256 digest, and tagged commit SHA.
set -euo pipefail

DEFAULT_GITHUB_REPO="RobinChiam/rcstack"
REQUIRED_ARCHIVE_PATHS=(README.md AGENTS.md docs specs rules profiles contracts skills scripts adapters tests)
OPTIONAL_ARCHIVE_PATHS=(assets CHANGELOG.md)

usage() {
  cat <<'USAGE'
Usage: bash adapters/build-release.sh --tag <vX.Y.Z> --out-dir <dir> [--repo <owner/repo>] [--source-repo <dir>]

  --tag <vX.Y.Z>       git tag to package (required; must resolve to a commit)
  --out-dir <dir>      output directory for rcstack-<ver>.tar.gz and install.sh (required; outside repo)
  --repo <owner/repo>  GitHub repository for pinned release URL (default: RobinChiam/rcstack)
  --source-repo <dir>  git repository to package from (default: repository containing this script)
  -h, --help           show this help
USAGE
}

say() { printf '%s\n' "$*"; }
die() {
  printf 'build-release: error: %s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------- arguments
TAG=""
OUT_DIR=""
GITHUB_REPO="$DEFAULT_GITHUB_REPO"
SOURCE_REPO="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag)
      [ "$#" -ge 2 ] || die "--tag needs a git tag (e.g. v0.2.1)"
      TAG="$2"
      shift
      ;;
    --tag=*) TAG="${1#*=}" ;;
    --out-dir)
      [ "$#" -ge 2 ] || die "--out-dir needs a directory"
      OUT_DIR="$2"
      shift
      ;;
    --out-dir=*) OUT_DIR="${1#*=}" ;;
    --repo)
      [ "$#" -ge 2 ] || die "--repo needs <owner/repo>"
      GITHUB_REPO="$2"
      shift
      ;;
    --repo=*) GITHUB_REPO="${1#*=}" ;;
    --source-repo)
      [ "$#" -ge 2 ] || die "--source-repo needs a directory"
      SOURCE_REPO="$2"
      shift
      ;;
    --source-repo=*) SOURCE_REPO="${1#*=}" ;;
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

[ -n "$TAG" ] || { usage >&2; die "--tag is required"; }
[ -n "$OUT_DIR" ] || { usage >&2; die "--out-dir is required"; }
[[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "--tag must match vMAJOR.MINOR.PATCH (got: $TAG)"
[[ "$GITHUB_REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "--repo must match owner/repo (got: $GITHUB_REPO)"
case "$OUT_DIR$SOURCE_REPO" in
  *$'\n'*) die "paths must not contain a newline" ;;
esac

absolute() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

normalize() {
  local out="" seg
  local -a parts
  IFS=/ read -r -a parts <<<"$1"
  for seg in ${parts[@]+"${parts[@]}"}; do
    case "$seg" in
      '' | .) ;;
      ..) out="${out%/*}" ;;
      *) out="$out/$seg" ;;
    esac
  done
  printf '%s\n' "${out:-/}"
}

physical() {
  local p="$1" rest="" base
  while [ ! -d "$p" ]; do
    rest="/$(basename "$p")$rest"
    p="$(dirname "$p")"
  done
  base="$(cd -P "$p" && pwd -P)"
  printf '%s%s\n' "${base%/}" "$rest"
}

SOURCE_REPO="$(normalize "$(absolute "$SOURCE_REPO")")"
[ -d "$SOURCE_REPO" ] || die "source repository does not exist: $SOURCE_REPO"
SOURCE_REPO="$(cd -P "$SOURCE_REPO" && pwd -P)"

OUT_DIR="$(normalize "$(absolute "$OUT_DIR")")"
[ "$OUT_DIR" != "/" ] || die "refusing to use / as --out-dir"
case "$(physical "$OUT_DIR")/" in
  "$SOURCE_REPO"/*) die "--out-dir ($OUT_DIR) is inside the source repository ($SOURCE_REPO); choose an output directory outside it" ;;
esac

# ---------------------------------------------------------------------------- preflight
for tool in git node tar gzip chmod cp mv rm mkdir mktemp find sed bash tr; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  die "Node.js >= 20 is required (found $(node --version))"

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

commit_sha="$(git -C "$SOURCE_REPO" rev-parse --verify --quiet "refs/tags/${TAG}^{commit}" || true)"
[ -n "$commit_sha" ] || die "git tag not found or does not point to a commit: $TAG"
[[ "$commit_sha" =~ ^[0-9a-f]{40}$ ]] || die "unexpected commit SHA for $TAG: $commit_sha"

VERSION="${TAG#v}"
ARCHIVE_NAME="rcstack-${VERSION}.tar.gz"
ARCHIVE_URL="https://github.com/${GITHUB_REPO}/releases/download/${TAG}/${ARCHIVE_NAME}"

archive_paths=()
for p in "${REQUIRED_ARCHIVE_PATHS[@]}"; do
  git -C "$SOURCE_REPO" cat-file -e "${commit_sha}:${p}" 2>/dev/null ||
    die "tagged commit $TAG ($commit_sha) is missing required path: $p"
  archive_paths+=("$p")
done
for p in "${OPTIONAL_ARCHIVE_PATHS[@]}"; do
  if git -C "$SOURCE_REPO" cat-file -e "${commit_sha}:${p}" 2>/dev/null; then
    archive_paths+=("$p")
  fi
done

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
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/rcstack-build-release.XXXXXX")"
chmod 700 "$WORKDIR"
umask "$old_umask"

archive_tmp="$WORKDIR/$ARCHIVE_NAME"
script_tmp="$WORKDIR/install.sh"

# ---------------------------------------------------------------------------- 1. package via git archive
git -C "$SOURCE_REPO" archive --format=tar --prefix="rcstack-${VERSION}/" "$commit_sha" -- "${archive_paths[@]}" |
  gzip -n -9 >"$archive_tmp"

# ---------------------------------------------------------------------------- 2. validate staged archive
stage_dir="$WORKDIR/stage"
mkdir -p "$stage_dir"
tar -xzf "$archive_tmp" -C "$stage_dir"
staged_root="$stage_dir/rcstack-${VERSION}"

[ -d "$staged_root" ] || die "staged archive is missing root directory rcstack-${VERSION}/"
[ -f "$staged_root/scripts/verify.mjs" ] || die "staged archive is missing scripts/verify.mjs"
[ -f "$staged_root/adapters/install.sh" ] || die "staged archive is missing adapters/install.sh"
[ -f "$staged_root/adapters/release-install.sh" ] || die "staged archive is missing adapters/release-install.sh"

staged_links="$(find "$staged_root" -type l -print)"
[ -z "$staged_links" ] || die "staged archive contains symbolic links: $(printf '%s' "$staged_links" | tr '\n' ' ')"

if ! verify_out="$(node "$staged_root/scripts/verify.mjs" --root "$staged_root" --include-ignored --quiet 2>&1)"; then
  printf '%s\n' "$verify_out" >&2
  die "staged archive from $TAG ($commit_sha) failed scripts/verify.mjs"
fi

staged_version="$(sed -n 's/^RCSTACK_VERSION="\([^"]*\)"$/\1/p' "$staged_root/adapters/install.sh" | head -n 1)"
[ "$staged_version" = "$VERSION" ] ||
  die "tag version ($VERSION) does not match adapters/install.sh RCSTACK_VERSION (${staged_version:-missing}) in $TAG ($commit_sha)"

dry_home="$WORKDIR/dry-home"
mkdir -p "$dry_home"
if ! dry_out="$(HOME="$dry_home" bash "$staged_root/adapters/install.sh" --dry-run --home "$dry_home" 2>&1)"; then
  printf '%s\n' "$dry_out" >&2
  die "staged adapters/install.sh --dry-run failed for $TAG ($commit_sha)"
fi

# ---------------------------------------------------------------------------- 3. digest & standalone script
archive_sha256="$(sha256_file "$archive_tmp" | tr '[:upper:]' '[:lower:]')"
[[ "$archive_sha256" =~ ^[0-9a-f]{64}$ ]] || die "failed to compute SHA-256 for $ARCHIVE_NAME"

node - "$staged_root/adapters/release-install.sh" "$script_tmp" \
  "$VERSION" "$TAG" "$commit_sha" "$ARCHIVE_NAME" "$ARCHIVE_URL" "$archive_sha256" <<'NODE'
const fs = require('node:fs');
const [templatePath, outPath, version, tag, commit, archiveName, archiveUrl, sha256] = process.argv.slice(2);
const rendered = fs
  .readFileSync(templatePath, 'utf8')
  .replaceAll('__RCSTACK_VERSION__', version)
  .replaceAll('__RCSTACK_TAG__', tag)
  .replaceAll('__RCSTACK_COMMIT__', commit)
  .replaceAll('__RCSTACK_ARCHIVE_NAME__', archiveName)
  .replaceAll('__RCSTACK_ARCHIVE_URL__', archiveUrl)
  .replaceAll('__RCSTACK_ARCHIVE_SHA256__', sha256);
if (rendered.includes('__RCSTACK_')) {
  console.error('unreplaced release template placeholder found');
  process.exit(1);
}
fs.writeFileSync(outPath, rendered, 'utf8');
NODE

chmod 755 "$script_tmp"
bash -n "$script_tmp" || die "generated install.sh failed bash -n"

if ! wrapper_dry_out="$(HOME="$dry_home" bash "$script_tmp" --dry-run --home "$dry_home" 2>&1)"; then
  printf '%s\n' "$wrapper_dry_out" >&2
  die "generated install.sh --dry-run failed"
fi

# ---------------------------------------------------------------------------- 4. write release outputs
mkdir -p "$OUT_DIR"
out_archive="$OUT_DIR/$ARCHIVE_NAME"
out_script="$OUT_DIR/install.sh"

out_archive_tmp="$OUT_DIR/.$ARCHIVE_NAME.$$"
out_script_tmp="$OUT_DIR/.install.sh.$$"
cp "$archive_tmp" "$out_archive_tmp"
chmod 644 "$out_archive_tmp"
cp "$script_tmp" "$out_script_tmp"
chmod 755 "$out_script_tmp"
mv "$out_archive_tmp" "$out_archive"
mv "$out_script_tmp" "$out_script"

say "build-release: OK"
say "  tag:      $TAG"
say "  commit:   $commit_sha"
say "  repo:     $GITHUB_REPO"
say "  url:      $ARCHIVE_URL"
say "  sha256:   $archive_sha256"
say "  archive:  $out_archive"
say "  script:   $out_script"
