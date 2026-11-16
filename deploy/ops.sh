#!/bin/sh
# 在独立 ClassFlow 部署目录运行；只管理指定的 Compose 项目。
set -eu
umask 077
cd "$(dirname "$0")/.."
compose() { docker compose --project-name classflow --env-file .env.production -f compose.yaml "$@"; }
case "${1:-}" in
  check) compose config --quiet; compose ps ;;
  apply)
    [ "${CLASSFLOW_CHANGE_APPROVED:-}" = yes ] || { echo '需要已批准的生产变更计划。' >&2; exit 2; }
    compose build app
    compose up -d --no-build --wait app ;;
  backup) compose exec -T app node apps/api/dist/backup-cli.js create ;;
  restore-new)
    [ "$#" = 3 ] || { echo '用法：restore-new <快照文件名> <新数据槽名>' >&2; exit 2; }
    case "$2" in *[!A-Za-z0-9._-]*|''|.*) exit 2;; esac
    case "$3" in *[!A-Za-z0-9_-]*|'') exit 2;; esac
    compose exec -T app node apps/api/dist/backup-cli.js restore "/var/backups/classflow/$2" "/var/lib/classflow/$3" ;;
  *) echo '用法：sh deploy/ops.sh check|apply|backup|restore-new' >&2; exit 2 ;;
esac
