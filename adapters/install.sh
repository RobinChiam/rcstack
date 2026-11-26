#!/usr/bin/env bash
# adapters/install.sh — atomic promoter into ~/.rcstack/dist/ + harness symlinker.
#
#   bash adapters/install.sh [--from-local | --from-release --release-commit <sha>] [--dry-run] [--home <dir>] [--rcstack-home <dir>]
#
# Promotes this checkout (or a verified unpacked release archive) into <rcstack-home>/dist,
# seeds <rcstack-home>/profiles/rcstack-main.yaml on a fresh install (preserving existing
# machine-local consolidated or legacy profiles without shadowing them), initializes the
# <rcstack-home>/runtime shadow git repository, and symlinks the 5 top-level skills from
# <rcstack-home>/dist/skills/<skill> into each harness directory under <home>. Harness links
# never point into this checkout.
#
# Idempotent. Refuses to overwrite any non-symlink destination, and checks for that before it
# changes anything. --dry-run prints the plan and mutates nothing.
set -euo pipefail

RCSTACK_VERSION="0.2.1"
SKILLS="rc-router rc-setup rc-init rc-doctor rc-retro"
HARNESSES=".agents .claude .codex .gemini .cursor"
STAGED_DIRS="rules profiles contracts scripts skills"
MAIN_PROFILE="rcstack-main.yaml"
LEGACY_PROFILES="rcstack-engineering.yaml rcstack-study.yaml rcstack-research.yaml"

usage() {
  cat <<'USAGE'
Usage: bash adapters/install.sh [--from-local | --from-release --release-commit <sha>] [--dry-run] [--home <dir>] [--rcstack-home <dir>]

  --from-local              promote this checkout (default)
  --from-release            promote a verified unpacked release source (requires --release-commit)
  --release-commit <sha>    40-character lowercase hex commit SHA for --from-release metadata
  --dry-run                 print the plan; create, change, and delete nothing
  --home <dir>              home directory holding the harness skill directories (default: $HOME)
  --rcstack-home <dir>      installed runtime home (default: <home>/.rcstack)
  -h, --help                show this help
USAGE
}

say() { printf '%s\n' "$*"; }
die() {
  printf 'install: error: %s\n' "$*" >&2
  exit 1
}

# ---------------------------------------------------------------------------- arguments
DRY_RUN=0
FROM_LOCAL=0
FROM_RELEASE=0
RELEASE_COMMIT=""
HOME_DIR="${HOME:-}"
RC_HOME=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --from-local) FROM_LOCAL=1 ;;
    --from-release) FROM_RELEASE=1 ;;
    --release-commit)
      [ "$#" -ge 2 ] || die "--release-commit needs a 40-character commit SHA"
      RELEASE_COMMIT="$2"
      shift
      ;;
    --release-commit=*) RELEASE_COMMIT="${1#*=}" ;;
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

if [ "$FROM_LOCAL" -eq 1 ] && [ "$FROM_RELEASE" -eq 1 ]; then
  die "--from-local and --from-release cannot be combined"
fi
if [ "$FROM_RELEASE" -eq 1 ]; then
  [ -n "$RELEASE_COMMIT" ] || die "--from-release requires --release-commit <40-hex-sha>"
  [[ "$RELEASE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || die "--release-commit must be a 40-character lowercase hex SHA"
elif [ -n "$RELEASE_COMMIT" ]; then
  die "--release-commit requires --from-release"
fi

absolute() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *) printf '%s/%s\n' "$PWD" "$1" ;;
  esac
}

# Lexically resolve "." and ".." in an absolute path, so a path cannot name one place and mean another.
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

# True when something is there, including a dangling symbolic link.
present() { [ -e "$1" ] || [ -L "$1" ]; }

# Resolve symlinks in the part of a path that already exists (the rest may not exist yet).
physical() {
  local p="$1" rest="" base
  while [ ! -d "$p" ]; do
    rest="/$(basename "$p")$rest"
    p="$(dirname "$p")"
  done
  base="$(cd -P "$p" && pwd -P)"
  printf '%s%s\n' "${base%/}" "$rest"
}

[ -n "$HOME_DIR" ] || die "no home directory: set \$HOME or pass --home <dir>"
case "$HOME_DIR$RC_HOME" in
  *$'\n'*) die "paths must not contain a newline" ;;
esac
HOME_DIR="$(normalize "$(absolute "$HOME_DIR")")"
[ "$HOME_DIR" != "/" ] || die "refusing to use / as the home directory"
[ -d "$HOME_DIR" ] || die "home directory does not exist: $HOME_DIR"

[ -n "$RC_HOME" ] || RC_HOME="$HOME_DIR/.rcstack"
RC_HOME="$(normalize "$(absolute "$RC_HOME")")"
[ "$RC_HOME" != "/" ] || die "refusing to use / as the rcstack home"

SRC="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
DIST="$RC_HOME/dist"

# The source checkout stays clean: nothing is ever installed inside it.
for target in "$RC_HOME" "$HOME_DIR"; do
  case "$(physical "$target")/" in
    "$SRC"/*) die "$target is inside the source checkout ($SRC); choose a location outside it" ;;
  esac
done

# ---------------------------------------------------------------------------- preflight (read-only)
for tool in git node cp mv rm ln mkdir chmod mktemp find date readlink; do
  command -v "$tool" >/dev/null 2>&1 || die "required command not found: $tool"
done
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' ||
  die "Node.js >= 20 is required (found $(node --version))"

for dir in $STAGED_DIRS; do
  [ -d "$SRC/$dir" ] || die "source checkout is missing $dir/"
done
[ -f "$SRC/profiles/schema.json" ] || die "source checkout is missing profiles/schema.json"
[ -f "$SRC/profiles/$MAIN_PROFILE" ] || die "source checkout is missing profiles/$MAIN_PROFILE"
for skill in $SKILLS; do
  [ -f "$SRC/skills/$skill/SKILL.md" ] || die "source checkout is missing skills/$skill/SKILL.md"
done
for entry in "$SRC"/skills/*; do
  case " $SKILLS " in
    *" $(basename "$entry") "*) ;;
    *) die "unexpected entry in skills/: $(basename "$entry") (exactly 5 skills are installed)" ;;
  esac
done

# A symlink in the source could smuggle files from outside the checkout into dist.
# shellcheck disable=SC2086
links="$(cd "$SRC" && find $STAGED_DIRS -type l -print)"
[ -z "$links" ] || die "source contains symbolic links, refusing to stage them: $(printf '%s' "$links" | tr '\n' ' ')"

# Only a checkout that passes its own validator is promoted.
if ! verify_out="$(node "$SRC/scripts/verify.mjs" --root "$SRC" --include-ignored --quiet 2>&1)"; then
  printf '%s\n' "$verify_out" >&2
  die "the source checkout does not pass scripts/verify.mjs; nothing was changed"
fi

# Every destination is checked before anything is changed. `present` also sees dangling symbolic
# links, which `[ -e ]` reports as absent and which would otherwise fail halfway through an install.
collisions=0
collide() {
  say "COLLISION: $1" >&2
  collisions=$((collisions + 1))
}
[ ! -L "$DIST" ] || collide "$DIST is a symbolic link; refusing to replace it"
for dir in "$RC_HOME" "$DIST" "$RC_HOME/profiles" "$RC_HOME/runtime" "$RC_HOME/runtime/state"; do
  if present "$dir" && [ ! -d "$dir" ]; then collide "$dir exists and is not a directory"; fi
done
meta="$RC_HOME/install-meta.json"
if present "$meta" && { [ -L "$meta" ] || [ ! -f "$meta" ]; }; then collide "$meta exists and is not a regular file"; fi
# `git init` follows a symbolic link, so the shadow repository's .git must be a real directory.
shadow_git="$RC_HOME/runtime/.git"
if present "$shadow_git" && { [ -L "$shadow_git" ] || [ ! -d "$shadow_git" ]; }; then collide "$shadow_git exists and is not a directory"; fi
for harness in $HARNESSES; do
  for parent in "$HOME_DIR/$harness" "$HOME_DIR/$harness/skills"; do
    if present "$parent" && [ ! -d "$parent" ]; then collide "$parent exists and is not a directory"; fi
  done
  for skill in $SKILLS; do
    dest="$HOME_DIR/$harness/skills/$skill"
    if [ -e "$dest" ] && [ ! -L "$dest" ]; then collide "$dest exists and is not a symbolic link"; fi
  done
done
[ "$collisions" -eq 0 ] ||
  die "refusing to overwrite $collisions conflicting destination(s); move them aside and re-run. Nothing was changed"

if [ "$FROM_RELEASE" -eq 1 ]; then
  meta_source="release"
  commit_sha="$RELEASE_COMMIT"
  dirty="false"
else
  meta_source="local"
  commit_sha="$(git -C "$SRC" rev-parse --verify --quiet HEAD 2>/dev/null || true)"
  [ -n "$commit_sha" ] || commit_sha="unknown"
  dirty="false"
  # --no-optional-locks: reading the status must not refresh (write) the source checkout's index.
  if [ -n "$(git -C "$SRC" --no-optional-locks status --porcelain --untracked-files=normal 2>/dev/null || true)" ]; then dirty="true"; fi
fi

# ---------------------------------------------------------------------------- plan
if [ "$DRY_RUN" -eq 1 ]; then
  DO="[dry-run] would"
  MODE="DRY RUN: nothing will be created, changed, or deleted"
else
  DO="->"
  MODE="install"
fi

say "rcstack-beta $RCSTACK_VERSION installer"
if [ "$meta_source" = "release" ]; then
  say "  source:        release ($SRC, commit $commit_sha)"
else
  say "  source:        $SRC (commit $commit_sha, uncommitted changes: $dirty)"
fi
say "  rcstack home:  $RC_HOME"
say "  harness home:  $HOME_DIR"
say "  mode:          $MODE"
say ""

# ---------------------------------------------------------------------------- mutation helpers
STAGE=""
PREV=""
LOCK=""
cleanup() {
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
    chmod -R u+w "$STAGE" 2>/dev/null || true
    rm -rf "$STAGE"
  fi
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    if [ ! -e "$DIST" ]; then
      mv "$PREV" "$DIST" || true # the swap failed halfway: put the previous dist back
    else
      chmod -R u+w "$PREV" 2>/dev/null || true
      rm -rf "$PREV"
    fi
  fi
  if [ -n "$LOCK" ] && [ -d "$LOCK" ]; then rmdir "$LOCK" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------- 1. stage
say "$DO stage rules/, profiles/ (as defaults/profiles/), contracts/, scripts/, skills/ in $RC_HOME/.staging.*"
if [ "$DRY_RUN" -eq 0 ]; then
  mkdir -p "$RC_HOME"
  mkdir "$RC_HOME/.install.lock" 2>/dev/null ||
    die "another install is running, or one crashed: remove $RC_HOME/.install.lock if none is in progress"
  LOCK="$RC_HOME/.install.lock"

  STAGE="$(mktemp -d "$RC_HOME/.staging.XXXXXX")"
  mkdir "$STAGE/defaults"
  cp -RPp "$SRC/rules" "$STAGE/rules"
  cp -RPp "$SRC/profiles" "$STAGE/defaults/profiles"
  cp -RPp "$SRC/contracts" "$STAGE/contracts"
  cp -RPp "$SRC/scripts" "$STAGE/scripts"
  cp -RPp "$SRC/skills" "$STAGE/skills"

  for skill in $SKILLS; do
    [ -f "$STAGE/skills/$skill/SKILL.md" ] || die "staging is incomplete: skills/$skill/SKILL.md"
  done
  [ -f "$STAGE/defaults/profiles/schema.json" ] || die "staging is incomplete: defaults/profiles/schema.json"
  [ -f "$STAGE/defaults/profiles/$MAIN_PROFILE" ] || die "staging is incomplete: defaults/profiles/$MAIN_PROFILE"
  [ -z "$(find "$STAGE" -type l -print)" ] || die "staging contains a symbolic link"

  # dist is read-only: nothing edits installed skills through a harness symlink.
  chmod 755 "$STAGE"
  chmod -R a-w "$STAGE"
fi

# ---------------------------------------------------------------------------- 2. swap
say "$DO atomically swap staging into $DIST"
if [ "$DRY_RUN" -eq 0 ]; then
  if [ ! -e "$DIST" ]; then
    mv "$STAGE" "$DIST"
    STAGE=""
  elif [ -z "${RCSTACK_INSTALL_NO_EXCHANGE:-}" ] && mv --exchange --no-target-directory "$STAGE" "$DIST" 2>/dev/null; then
    : # one atomic exchange; $STAGE now holds the previous dist and cleanup removes it
  else
    # Portable path: two atomic renames on one filesystem, rolled back by cleanup on failure.
    # The previous dist is parked under a name mktemp just proved unused. It stays in the same
    # parent: a read-only directory can be renamed in place but not moved to another directory.
    parked="$(mktemp -d "$RC_HOME/.dist-prev.XXXXXX")"
    rmdir "$parked"
    mv "$DIST" "$parked"
    PREV="$parked"
    mv "$STAGE" "$DIST"
    STAGE=""
  fi
fi

# ---------------------------------------------------------------------------- 3. install-meta.json
say "$DO write $RC_HOME/install-meta.json (version $RCSTACK_VERSION, source $meta_source)"
if [ "$DRY_RUN" -eq 0 ]; then
  meta_tmp="$RC_HOME/.install-meta.json.$$"
  printf '{\n  "version": "%s",\n  "commit_sha": "%s",\n  "source": "%s",\n  "dirty": %s,\n  "installed_at": "%s"\n}\n' \
    "$RCSTACK_VERSION" "$commit_sha" "$meta_source" "$dirty" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$meta_tmp"
  mv "$meta_tmp" "$RC_HOME/install-meta.json"
fi

# ---------------------------------------------------------------------------- 4. profiles
if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$RC_HOME/profiles"; fi
main_dest="$RC_HOME/profiles/$MAIN_PROFILE"
has_legacy=0
for legacy in $LEGACY_PROFILES; do
  legacy_dest="$RC_HOME/profiles/$legacy"
  if present "$legacy_dest"; then
    has_legacy=1
    say "$DO keep $legacy_dest (machine-local profiles are never overwritten)"
  fi
done
if present "$main_dest"; then
  say "$DO keep $main_dest (machine-local profiles are never overwritten)"
elif [ "$has_legacy" -eq 1 ]; then
  say "$DO skip seeding $main_dest (existing legacy profile(s) preserved)"
else
  say "$DO seed $main_dest"
  if [ "$DRY_RUN" -eq 0 ]; then
    cp "$DIST/defaults/profiles/$MAIN_PROFILE" "$main_dest"
    chmod u+w "$main_dest"
  fi
fi

# ---------------------------------------------------------------------------- 5. runtime shadow git
if [ -e "$RC_HOME/runtime/.git" ]; then
  say "$DO keep $RC_HOME/runtime (shadow git repository already initialized)"
else
  say "$DO initialize the local-only shadow git repository in $RC_HOME/runtime"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$RC_HOME/runtime"
    git -c init.defaultBranch=main init -q "$RC_HOME/runtime"
  fi
fi
if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$RC_HOME/runtime/state"; fi

# ---------------------------------------------------------------------------- 6. harness links
linked=0
for harness in $HARNESSES; do
  if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$HOME_DIR/$harness/skills"; fi
  for skill in $SKILLS; do
    dest="$HOME_DIR/$harness/skills/$skill"
    target="$DIST/skills/$skill"
    if [ -L "$dest" ]; then
      current="$(readlink "$dest")"
      if [ "$current" = "$target" ]; then
        say "$DO keep $dest -> $target"
      else
        say "$DO repoint $dest -> $target (was -> $current)"
        if [ "$DRY_RUN" -eq 0 ]; then
          rm -f "$dest"
          ln -s "$target" "$dest"
        fi
      fi
    elif [ -e "$dest" ]; then
      die "refusing to overwrite non-symlink $dest (it appeared during the install)"
    else
      say "$DO link $dest -> $target"
      if [ "$DRY_RUN" -eq 0 ]; then ln -s "$target" "$dest"; fi
    fi
    linked=$((linked + 1))
  done
done

say ""
if [ "$DRY_RUN" -eq 1 ]; then
  say "install: dry run complete: $linked link(s) planned, 0 collisions, nothing changed"
else
  say "install: OK: rcstack-beta $RCSTACK_VERSION promoted to $DIST; $linked harness link(s) point there"
fi
