#!/usr/bin/env bash
#
# 361gadgets backend deploy. Runs ON THE VPS as user grishan.
#
# Installed at /var/www/gadgets/deploy/backend.sh and set as the forced command
# of the GitHub Actions deploy key in ~/.ssh/authorized_keys, so that key can
# run this script and nothing else. GitHub Actions sends one of:
#
#   check  <sha>           verify the server is ready to deploy <sha> and report
#                          how many new migrations it brings; changes nothing
#   deploy <sha>           build <sha> in a new release folder, switch to it,
#                          health-check, roll back the code if it fails.
#                          Refuses if <sha> brings migrations.
#   deploy <sha> migrate   the same, but when migrations are pending: pg_dump
#                          the database first (abort if that fails), then
#                          `prisma migrate deploy`, then switch.
#
# By hand (ssh in normally, then run it):
#   backend.sh status              current release + the ones kept on disk
#   backend.sh rollback [folder]   switch the CODE back to the previous (or named)
#                                  release. Never undoes migrations; see below.
#   backend.sh bootstrap <sha>     one-time: build the first release and create
#                                  the backend-current link, without touching PM2
#
# Migrations are never rolled back automatically. They are written to be
# additive (new columns/indexes), so the previous code keeps working against
# the migrated database. If a migration itself must be undone, restore the
# pre-migration dump printed in the deploy log (pg_restore), by hand.
#
set -Eeuo pipefail
umask 002

APP_ROOT=/var/www/gadgets
REPO=$APP_ROOT/repos/backend.git
RELEASES=$APP_ROOT/backend-releases
CURRENT=$APP_ROOT/backend-current
SHARED_ENV=$APP_ROOT/shared/backend.env
BACKUP_DIR=/var/www/backups/pre-migrate
LOCK_FILE=$APP_ROOT/deploy/backend.lock
PM2_NAME=gadgets-api
HEALTH_URL=http://127.0.0.1:5001/api/health/ready
BRANCH=main
KEEP_RELEASES=4
MIN_FREE_GB=3

export PATH=/usr/local/bin:/usr/bin:/bin

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Arguments come from the SSH forced command, or from the command line by hand.
read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-$*}"
ACTION=${ARGS[0]:-}
TARGET=${ARGS[1]:-}
OPTION=${ARGS[2]:-}

DEST=""
BUILDING=""
# Runs on any exit: if a build was in progress, delete the half-built release.
on_exit() {
  if [[ -n "$BUILDING" && -n "$DEST" && -d "$DEST" ]]; then
    log "Deploy stopped before the switch. Removing $DEST; the live API was not touched."
    rm -rf -- "$DEST"
  fi
}
trap on_exit EXIT

require_sha() {
  [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]] || die "expected a full 40-character commit sha, got '$TARGET'"
}

fetch_and_verify_commit() {
  [[ -d "$REPO" ]] || die "missing bare repo $REPO (one-time setup not done)"
  log "Fetching $BRANCH"
  git --git-dir="$REPO" fetch --quiet --prune origin "+refs/heads/$BRANCH:refs/heads/$BRANCH"
  git --git-dir="$REPO" cat-file -e "$TARGET^{commit}" 2>/dev/null \
    || die "commit $TARGET not found on GitHub"
  git --git-dir="$REPO" merge-base --is-ancestor "$TARGET" "$BRANCH" \
    || die "commit $TARGET is not on $BRANCH; refusing to deploy it"
  log "Commit: $(git --git-dir="$REPO" log -1 --format='%h %s' "$TARGET")"
}

check_disk() {
  local free_kb
  free_kb=$(df --output=avail -k "$APP_ROOT" | tail -1 | tr -d ' ')
  (( free_kb > MIN_FREE_GB * 1024 * 1024 )) || die "less than ${MIN_FREE_GB} GB free under $APP_ROOT"
}

live_release() { readlink -f "$CURRENT" 2>/dev/null || true; }
live_revision() { cat "$CURRENT/REVISION" 2>/dev/null || true; }

pm2_cwd() {
  local pid
  pid=$(pm2 pid "$PM2_NAME" 2>/dev/null | tail -1)
  [[ "$pid" =~ ^[0-9]+$ && "$pid" != 0 ]] || return 1
  readlink -f "/proc/$pid/cwd"
}

# Migration folders in <sha> that the live revision does not have.
new_migrations() {
  local live
  live=$(live_revision)
  [[ "$live" =~ ^[0-9a-f]{40}$ ]] || die "live release has no REVISION file"
  comm -13 \
    <(git --git-dir="$REPO" ls-tree -d --name-only "$live:prisma/migrations" | sort) \
    <(git --git-dir="$REPO" ls-tree -d --name-only "$TARGET:prisma/migrations" | sort)
}

# Reads one value from the shared .env without sourcing the whole file.
env_value() {
  local v
  v=$(grep -E "^$1=" "$SHARED_ENV" | tail -1 | cut -d= -f2- | tr -d '\r')
  v=${v#\"}; v=${v%\"}; v=${v#\'}; v=${v%\'}
  printf '%s' "$v"
}

health_check() {
  local i
  for i in $(seq 1 30); do
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL"; then
      log "Health check passed (attempt $i): API up and database reachable"
      return 0
    fi
    sleep 2
  done
  return 1
}

# Point backend-current at $1 atomically, restart the API, and confirm it is
# really running from that folder and healthy.
switch_to() {
  local release=$1
  ln -sfn "$release" "$CURRENT.new"
  mv -Tf "$CURRENT.new" "$CURRENT"
  log "backend-current -> $(basename "$release")"
  pm2 reload "$PM2_NAME" >/dev/null
  sleep 3
  local cwd
  cwd=$(pm2_cwd || true)
  [[ "$cwd" == "$release" ]] || { log "PM2 is running from '$cwd', expected '$release'"; return 1; }
  health_check
}

build_release() {
  local stamp
  stamp=$(date '+%Y%m%d-%H%M%S')
  DEST="$RELEASES/$stamp-${TARGET:0:7}"
  BUILDING=1
  mkdir -p "$DEST"
  log "Exporting ${TARGET:0:7} to $DEST"
  git --git-dir="$REPO" archive "$TARGET" | tar -x -C "$DEST"
  echo "$TARGET" > "$DEST/REVISION"
  ln -s "$SHARED_ENV" "$DEST/.env"

  cd "$DEST"
  log "npm ci (postinstall runs prisma generate)"
  npm ci --no-audit --no-fund --loglevel=error
  log "tsc build"
  npm run build
  [[ -f dist/server.js ]] || die "build finished without dist/server.js"
  log "Built $(basename "$DEST")"
}

# Prints pending migration names (one per line). Dies if the status is anything
# other than "up to date" or "has pending migrations" (failed migration, drift,
# no connection), because then migrating is not safe.
pending_migrations() {
  local out
  out=$(cd "$DEST" && npx prisma migrate status 2>&1) || true
  if grep -qiE "failed|drift" <<< "$out"; then
    printf '%s\n' "$out" >&2
    die "prisma reports failed migrations or drift; fix by hand before deploying"
  fi
  if grep -q "have not yet been applied" <<< "$out"; then
    grep -E '^[0-9]{14}_[A-Za-z0-9_]+$' <<< "$out" || true
    return 0
  fi
  grep -q "Database schema is up to date" <<< "$out" && return 0
  printf '%s\n' "$out" >&2
  die "could not read migration status (database unreachable?)"
}

# Fills the array named $1 with the lines printed by function $2. Unlike
# `mapfile < <(cmd)`, a failure inside the function stops the whole script.
lines_into() {
  local -n _arr=$1
  local _out
  _out=$("$2")
  _arr=()
  if [[ -n "$_out" ]]; then mapfile -t _arr <<< "$_out"; fi
}

backup_database() {
  local url file
  url=$(env_value DIRECT_URL)
  [[ -n "$url" ]] || url=$(env_value DATABASE_URL)
  [[ -n "$url" ]] || die "no DATABASE_URL in $SHARED_ENV"
  url=${url%%\?*}   # Prisma-only query params (schema=...) are not valid for pg_dump

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  file="$BACKUP_DIR/gadgets-$(date '+%Y%m%d-%H%M%S')-before-${TARGET:0:7}.dump"
  log "pg_dump -> $file"
  if ! pg_dump --format=custom --no-owner --file="$file" "$url"; then
    rm -f -- "$file"
    die "pg_dump failed; NOT migrating"
  fi
  chmod 600 "$file"
  [[ -s "$file" ]] || die "backup file is empty; NOT migrating"
  pg_restore --list "$file" > /dev/null || die "backup file is not a readable dump; NOT migrating"
  log "Backup OK ($(du -h "$file" | cut -f1)). Restore with: pg_restore --clean --if-exists --no-owner -d <db-url> $file"
}

cleanup_releases() {
  local live keep=0 dir
  live=$(live_release)
  while IFS= read -r dir; do
    [[ -z "$dir" ]] && continue
    if [[ "$dir" == "$live" ]] || (( keep < KEEP_RELEASES )); then
      keep=$((keep + 1))
      continue
    fi
    log "Removing old release $(basename "$dir")"
    rm -rf -- "$dir"
  done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort -r)
}

previous_release() {
  local live dir
  live=$(live_release)
  while IFS= read -r dir; do
    [[ "$dir" < "$live" && -f "$dir/dist/server.js" ]] && { echo "$dir"; return 0; }
  done < <(find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort -r)
  return 1
}

mkdir -p "$APP_ROOT/deploy" "$RELEASES"
exec 9>"$LOCK_FILE"
flock -n 9 || die "another backend deploy is already running"

case "$ACTION" in
  check)
    require_sha
    fetch_and_verify_commit
    check_disk
    [[ -f "$SHARED_ENV" ]] || die "missing $SHARED_ENV"
    [[ -L "$CURRENT" ]] || die "missing $CURRENT symlink (run bootstrap first)"
    log "Node $(node -v), npm $(npm -v), $(pg_dump --version)"
    log "Live release: $(basename "$(live_release)") (rev $(live_revision))"
    log "PM2 $PM2_NAME runs from: $(pm2_cwd || echo 'not running')"
    lines_into MIGS new_migrations
    if (( ${#MIGS[@]} )); then
      log "New migrations in ${TARGET:0:7}:"
      printf '    %s\n' "${MIGS[@]}"
    else
      log "No new migrations."
    fi
    echo "MIGRATION_COUNT=${#MIGS[@]}"
    log "Check OK. Nothing was changed."
    ;;

  deploy)
    require_sha
    [[ -z "$OPTION" || "$OPTION" == migrate ]] || die "unknown option '$OPTION'"
    [[ -L "$CURRENT" ]] || die "missing $CURRENT symlink (run bootstrap first)"
    [[ "$(pm2_cwd || true)" == "$(live_release)" ]] \
      || die "PM2 $PM2_NAME is not running from $CURRENT; finish the one-time PM2 switch first"
    fetch_and_verify_commit
    check_disk
    PREV=$(live_release)
    build_release

    lines_into PENDING pending_migrations
    if (( ${#PENDING[@]} )); then
      log "Pending migrations:"
      printf '    %s\n' "${PENDING[@]}"
      [[ "$OPTION" == migrate ]] || die "this deploy brings migrations but was not approved to migrate"
      backup_database
      log "prisma migrate deploy"
      (cd "$DEST" && npx prisma migrate deploy) \
        || die "migration FAILED. The old code is still live. Check: npx prisma migrate status (in $DEST). Backup is above."
      log "Migrations applied."
    else
      log "No pending migrations."
    fi
    BUILDING=""

    if switch_to "$DEST"; then
      cleanup_releases
      log "Deployed ${TARGET:0:7}."
    else
      log "New release failed its checks. Rolling the code back to $(basename "$PREV")"
      switch_to "$PREV" || log "WARNING: the previous release also failed its health check. Look at: pm2 logs $PM2_NAME"
      (( ${#PENDING[@]} )) && log "Note: migrations stay applied (they are additive; the previous code works with them)."
      die "deploy of ${TARGET:0:7} failed and the code was rolled back"
    fi
    ;;

  rollback)
    if [[ -n "$TARGET" ]]; then
      to="$RELEASES/$(basename "$TARGET")"
      [[ -f "$to/dist/server.js" ]] || die "no built release named $(basename "$TARGET")"
    else
      to=$(previous_release) || die "no earlier release to roll back to"
    fi
    switch_to "$to" || die "rolled back to $(basename "$to") but it failed its health check"
    log "Rolled back to $(basename "$to"). Database migrations were not touched."
    ;;

  bootstrap)
    require_sha
    [[ ! -e "$CURRENT" ]] || die "$CURRENT already exists; bootstrap is only for the first release"
    [[ -f "$SHARED_ENV" ]] || die "missing $SHARED_ENV"
    fetch_and_verify_commit
    check_disk
    build_release
    lines_into PENDING pending_migrations
    (( ${#PENDING[@]} == 0 )) || die "bootstrap commit has pending migrations; bootstrap the commit that is live"
    BUILDING=""
    ln -sfn "$DEST" "$CURRENT"
    log "Created $CURRENT -> $(basename "$DEST"). PM2 was not touched."
    ;;

  status)
    log "Live: $(basename "$(live_release)") (rev $(live_revision))"
    log "PM2 $PM2_NAME runs from: $(pm2_cwd || echo 'not running')"
    find "$RELEASES" -mindepth 1 -maxdepth 1 -type d | sort -r | sed 's#.*/#  #'
    ;;

  *)
    die "usage: backend.sh check|bootstrap <sha> | deploy <sha> [migrate] | rollback [release] | status"
    ;;
esac
