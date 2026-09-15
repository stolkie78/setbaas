#!/bin/bash
# SetBaas Backup Script
# Creates a timestamped backup of the PocketBase database
#
# Usage:
#   ./scripts/backup.sh                    # Backup to ./backups/
#   ./scripts/backup.sh /path/to/folder    # Backup to custom location
#   
# Cron example (dagelijks om 3:00):
#   0 3 * * * cd /path/to/setbaas && ./scripts/backup.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_DIR="${1:-$ROOT_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="setbaas_backup_${TIMESTAMP}.tar.gz"

# Detect compose file
if [ -f "$ROOT_DIR/docker-compose.prod.yml" ] && docker compose -f "$ROOT_DIR/docker-compose.prod.yml" ps --services 2>/dev/null | grep -q pocketbase; then
    COMPOSE_FILE="$ROOT_DIR/docker-compose.prod.yml"
else
    COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"
fi

echo "🏐 SetBaas Backup"
echo "  Compose: $COMPOSE_FILE"
echo "  Target:  $BACKUP_DIR/$BACKUP_FILE"

# Check if PocketBase is running
if ! docker compose -f "$COMPOSE_FILE" ps --services --filter status=running | grep -q pocketbase; then
    echo "❌ PocketBase container is not running"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create temp directory for backup files
TMPDIR=$(mktemp -d)
POCKETBASE_STOPPED=false
cleanup() {
    if [ "$POCKETBASE_STOPPED" = true ]; then
        docker compose -f "$COMPOSE_FILE" start pocketbase >/dev/null 2>&1 || true
    fi
    rm -rf "$TMPDIR"
}
trap cleanup EXIT

# Detect the actual PocketBase data directory. The muchobien image runs with
# --dir=/pb_data; older SetBaas compose files mounted /pb/pb_data instead.
if docker compose -f "$COMPOSE_FILE" exec -T pocketbase test -s /pb_data/data.db; then
    CONTAINER_DATA_DIR="/pb_data"
elif docker compose -f "$COMPOSE_FILE" exec -T pocketbase test -s /pb/pb_data/data.db; then
    CONTAINER_DATA_DIR="/pb/pb_data"
else
    echo "❌ Geen PocketBase database gevonden in /pb_data of /pb/pb_data"
    echo "   Backup afgebroken; er worden geen oude backups verwijderd."
    exit 1
fi

# Copy PocketBase data directory (database + uploads)
echo "⏸️  PocketBase tijdelijk stoppen voor een consistente databasekopie..."
docker compose -f "$COMPOSE_FILE" stop pocketbase >/dev/null
POCKETBASE_STOPPED=true

echo "📦 Copying PocketBase data..."
echo "  Source: $CONTAINER_DATA_DIR"
docker compose -f "$COMPOSE_FILE" cp "pocketbase:$CONTAINER_DATA_DIR/." "$TMPDIR/pb_data"

if [ ! -s "$TMPDIR/pb_data/data.db" ]; then
    echo "❌ Backup bevat geen geldige data.db"
    exit 1
fi

# Create compressed archive
echo "📦 Creating archive..."
tar -czf "$BACKUP_DIR/$BACKUP_FILE" -C "$TMPDIR" .

if ! tar -tzf "$BACKUP_DIR/$BACKUP_FILE" | grep -qE '(^|/)pb_data/data\.db$'; then
    echo "❌ Backupvalidatie mislukt: data.db ontbreekt in het archief"
    rm -f "$BACKUP_DIR/$BACKUP_FILE"
    exit 1
fi

echo "▶️  PocketBase opnieuw starten..."
docker compose -f "$COMPOSE_FILE" start pocketbase >/dev/null
POCKETBASE_STOPPED=false

# Show result
SIZE=$(du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)
echo ""
echo "✅ Backup compleet!"
echo "  Bestand: $BACKUP_DIR/$BACKUP_FILE ($SIZE)"
echo ""

# Cleanup old backups (keep last 7)
BACKUP_COUNT=$(ls -1 "$BACKUP_DIR"/setbaas_backup_*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 7 ]; then
    echo "🧹 Opruimen oude backups (behoud laatste 7)..."
    ls -1t "$BACKUP_DIR"/setbaas_backup_*.tar.gz | tail -n +8 | xargs rm -f
    echo "  Verwijderd: $((BACKUP_COUNT - 7)) oude backup(s)"
fi
