#!/usr/bin/env bash
# adapters/install.sh — idempotent harness symlink installer for rcstack-beta (SPEC.md §5.3).
#
# Links the 10 top-level skills into each harness skill directory and makes sure
# `.rcstack/state/` is listed in the user's global gitignore.
#
# Usage: bash adapters/install.sh [--dry-run] [--help]
#   --dry-run   Print every planned action. Makes zero filesystem or git config changes.
#
# For each destination <harness skills dir>/<skill>:
#   does not exist                -> create a symlink to $REPO_ROOT/skills/<skill>
#   symlink to that exact source  -> "[OK] already linked"
#   symlink to anything else      -> replace the symlink
#   real file or directory        -> refuse; nothing is changed anywhere; exit 1
#
# Every destination is classified before the first change, so a conflict never leaves a
# half-installed harness. The script never deletes a real file, never writes git config,
# and only ever links the 10 named skills: rc-router/playbooks is never flattened.
#
# Exit codes: 0 = success, 1 = conflict or failed precondition, 2 = bad usage.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: bash adapters/install.sh [--dry-run] [--help]

  --dry-run   Print every planned action; make zero filesystem or git config changes.
  --help      Show this help.

Links the 10 rcstack skills into ~/.agents/skills, ~/.claude/skills and ~/.codex/skills,
and adds ".rcstack/state/" to your global gitignore. Idempotent; refuses to overwrite
any real file or directory.
EOF
}

DRY_RUN=0
# A while/shift loop: older bash treats an empty argument list as unbound under `set -u`
# when it is expanded directly in a for loop.
while [ "$#" -gt 0 ]; do
  arg="$1"
  shift
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf '[ERROR] unknown argument: %s\n' "$arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "${HOME:-}" ] || [ ! -d "$HOME" ]; then
  printf '[ERROR] HOME is not set to an existing directory\n' >&2
  exit 1
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"

SKILLS=(rc-router rc-init rc-doctor rc-ground rc-architect rc-verify rc-audit rc-state rc-review-map rc-retro)
TARGETS=("$HOME/.agents/skills" "$HOME/.claude/skills" "$HOME/.codex/skills")
IGNORE_PATTERN='.rcstack/state/'

log() { printf '%s\n' "$*"; }

# act <description> <command...>: print the plan in --dry-run, otherwise run the command.
act() {
  local description="$1"
  shift
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[DRY-RUN] would $description"
  else
    "$@"
    log "[DONE] $description"
  fi
}

# classify <dest> <src> -> missing | linked | relink | conflict
classify() {
  local dest="$1" src="$2"
  if [ -L "$dest" ]; then
    if [ "$(readlink -- "$dest")" = "$src" ]; then printf 'linked'; else printf 'relink'; fi
  elif [ -e "$dest" ]; then
    printf 'conflict'
  else
    printf 'missing'
  fi
}

replace_symlink() {
  local dest="$1" src="$2"
  if [ ! -L "$dest" ]; then
    printf '[ERROR] %s changed while installing and is no longer a symlink; aborting\n' "$dest" >&2
    exit 1
  fi
  rm -- "$dest"
  ln -s -- "$src" "$dest"
}

# physical_path <dir>: the symlink-free path that <dir> has, or will have once it is created.
# Used to recognise two harness directories that are really the same directory.
physical_path() {
  local probe="$1" suffix=''
  while [ ! -d "$probe" ]; do
    suffix="/$(basename -- "$probe")$suffix"
    probe="$(dirname -- "$probe")"
  done
  probe="$(cd -P -- "$probe" && pwd -P)"
  if [ "$probe" = / ]; then probe=''; fi
  printf '%s%s' "$probe" "$suffix"
}

append_ignore_pattern() {
  local file="$1"
  mkdir -p -- "$(dirname -- "$file")"
  if [ -s "$file" ] && [ -n "$(tail -c 1 -- "$file")" ]; then
    printf '\n' >>"$file"
  fi
  printf '%s\n%s\n' '# rcstack: ephemeral per-branch session state (never committed)' "$IGNORE_PATTERN" >>"$file"
}

# ---------------------------------------------------------------------------
# Pass 1 — preflight. Collect every problem; change nothing.
# ---------------------------------------------------------------------------

problems=0
problem() {
  printf '[ERROR] %s\n' "$*" >&2
  problems=$((problems + 1))
}

# require_creatable <dir>: the directory, or its nearest existing ancestor, must be a writable,
# searchable directory, so that a later mkdir/ln cannot fail halfway through the install.
require_creatable() {
  local probe="$1"
  while [ ! -e "$probe" ] && [ ! -L "$probe" ]; do
    probe="$(dirname -- "$probe")"
  done
  if [ -L "$probe" ] && [ ! -e "$probe" ]; then
    problem "refusing to use $1: $probe is a dangling symlink"
  elif [ ! -d "$probe" ]; then
    problem "refusing to use $1: $probe exists and is not a directory"
  elif [ ! -w "$probe" ] || [ ! -x "$probe" ]; then
    problem "cannot write to $1: $probe is not a writable, searchable directory"
  fi
}

for skill in "${SKILLS[@]}"; do
  if [ ! -f "$REPO_ROOT/skills/$skill/SKILL.md" ]; then
    problem "source skill is missing: $REPO_ROOT/skills/$skill/SKILL.md"
  fi
done

for target in "${TARGETS[@]}"; do
  if [ -e "$target" ] && [ ! -d "$target" ]; then
    problem "refusing to use $target: it exists and is not a directory"
    continue
  fi
  if [ -d "$target" ] && [ ! -x "$target" ]; then
    problem "cannot inspect $target: the directory is not searchable"
    continue
  fi
  needs_change=0
  for skill in "${SKILLS[@]}"; do
    dest="$target/$skill"
    case "$(classify "$dest" "$REPO_ROOT/skills/$skill")" in
      conflict) problem "refusing to overwrite $dest: it exists and is not a symlink (move it away, then re-run)" ;;
      missing | relink) needs_change=1 ;;
    esac
  done
  if [ "$needs_change" -eq 1 ]; then require_creatable "$target"; fi
done

# The global gitignore: core.excludesFile when set, otherwise git's own default location.
EXCLUDES_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore"
if command -v git >/dev/null 2>&1; then
  if git config --global --get core.excludesFile >/dev/null 2>&1; then
    # --path expands "~" and exists in every git; --type=path is its newer spelling.
    EXCLUDES_FILE="$(git config --global --path --get core.excludesFile 2>/dev/null ||
      git config --global --type=path --get core.excludesFile 2>/dev/null || true)"
  else
    git_status=$?
    if [ "$git_status" -ne 1 ]; then
      problem "cannot read the global git config (git config exited $git_status); fix it, then re-run"
    fi
  fi
fi

ignore_needed=1
case "$EXCLUDES_FILE" in
  /*)
    if [ -L "$EXCLUDES_FILE" ] && [ ! -e "$EXCLUDES_FILE" ]; then
      problem "refusing to use $EXCLUDES_FILE as the global gitignore: it is a dangling symlink"
    elif [ -e "$EXCLUDES_FILE" ] && [ ! -f "$EXCLUDES_FILE" ]; then
      problem "refusing to use $EXCLUDES_FILE as the global gitignore: it is not a regular file"
    elif [ -f "$EXCLUDES_FILE" ] && [ ! -r "$EXCLUDES_FILE" ]; then
      problem "cannot read the global gitignore $EXCLUDES_FILE: it is not readable"
    elif [ -f "$EXCLUDES_FILE" ] && grep -qxF -- "$IGNORE_PATTERN" "$EXCLUDES_FILE"; then
      ignore_needed=0
    elif [ -f "$EXCLUDES_FILE" ] && [ ! -w "$EXCLUDES_FILE" ]; then
      problem "cannot write the global gitignore $EXCLUDES_FILE: it is not writable"
    elif [ ! -e "$EXCLUDES_FILE" ]; then
      require_creatable "$(dirname -- "$EXCLUDES_FILE")"
    fi
    ;;
  '') problem "git config --global core.excludesFile is set but resolves to an empty path; fix or unset it" ;;
  *) problem "global gitignore path is not absolute: $EXCLUDES_FILE (fix git config --global core.excludesFile)" ;;
esac

if [ "$problems" -gt 0 ]; then
  printf '[ERROR] %d problem(s) found; nothing was changed.\n' "$problems" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Pass 2 — apply (or print the plan in --dry-run).
# ---------------------------------------------------------------------------

if [ "$DRY_RUN" -eq 1 ]; then
  log "rcstack-beta installer — DRY RUN (no changes will be made)"
else
  log "rcstack-beta installer"
fi
log "Repo root: $REPO_ROOT"

linked=0
updated=0
unchanged=0
seen_dirs='|'

for target in "${TARGETS[@]}"; do
  physical="$(physical_path "$target")"
  case "$seen_dirs" in
    *"|$physical|"*)
      log "[SKIP] $target is the same directory as an earlier target ($physical)"
      continue
      ;;
  esac
  seen_dirs="$seen_dirs$physical|"
  if [ ! -d "$target" ]; then
    act "create directory $target" mkdir -p -- "$target"
  fi

  for skill in "${SKILLS[@]}"; do
    src="$REPO_ROOT/skills/$skill"
    dest="$target/$skill"
    case "$(classify "$dest" "$src")" in
      linked)
        log "[OK] already linked $dest -> $src"
        unchanged=$((unchanged + 1))
        ;;
      missing)
        act "link $dest -> $src" ln -s -- "$src" "$dest"
        linked=$((linked + 1))
        ;;
      relink)
        act "update $dest: $(readlink -- "$dest") -> $src" replace_symlink "$dest" "$src"
        updated=$((updated + 1))
        ;;
      conflict)
        printf '[ERROR] refusing to overwrite %s: it exists and is not a symlink\n' "$dest" >&2
        exit 1
        ;;
    esac
  done
done

if [ "$ignore_needed" -eq 0 ]; then
  log "[OK] already ignored $IGNORE_PATTERN in $EXCLUDES_FILE"
  ignore_summary='already present'
else
  if [ ! -e "$EXCLUDES_FILE" ]; then
    log "[NOTE] global gitignore $EXCLUDES_FILE does not exist yet; appending creates it"
  fi
  act "append \"$IGNORE_PATTERN\" to global gitignore $EXCLUDES_FILE" append_ignore_pattern "$EXCLUDES_FILE"
  ignore_summary='to add'
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "Summary (planned): $linked link(s) to create, $updated to update, $unchanged already linked; gitignore entry: $ignore_summary"
  log "[DRY-RUN] no filesystem or git config changes were made"
else
  log "Summary: $linked link(s) created, $updated updated, $unchanged already linked; gitignore entry: ${ignore_summary/to add/added}"
fi
