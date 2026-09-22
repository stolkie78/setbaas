#!/bin/bash
# SetBaas Deploy Script
# Creates a backup before deploying a new version
#
# Usage:
#   ./scripts/deploy.sh              # On the production server

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "🏐 SetBaas Deploy"
echo ""

# 1. Backup before deploy
echo "📦 Stap 1: Backup maken..."
if docker compose -f docker-compose.prod.yml ps --services --filter status=running 2>/dev/null | grep -q pocketbase; then
    ./scripts/backup.sh
else
    echo "  ⚠ PocketBase draait niet, backup overgeslagen"
fi

echo ""

# 2. Pull latest code
echo "📥 Stap 2: Code ophalen..."
git fetch --tags
git pull --ff-only

echo ""

# 3. Build and deploy
echo "🔨 Stap 3: Build en deploy..."
docker compose -f docker-compose.prod.yml build frontend
docker compose -f docker-compose.prod.yml up -d

echo ""

# 4. Run setup (idempotent, adds new collections/fields)
echo "⚙️  Stap 4: Database setup (schema migraties)..."
if docker compose -f docker-compose.prod.yml config --profiles 2>/dev/null | grep -q setup; then
    docker compose -f docker-compose.prod.yml --profile setup run --rm pb-setup || true
fi

echo ""

# 5. Verify services
echo "🔎 Stap 5: Services controleren..."
for i in $(seq 1 15); do
    if docker compose -f docker-compose.prod.yml exec -T frontend \
        wget -q --spider http://127.0.0.1:3000 2>/dev/null \
        && docker compose -f docker-compose.prod.yml exec -T pocketbase \
        wget -q --spider http://127.0.0.1:8090/api/health 2>/dev/null; then
        echo "  ✅ Frontend en PocketBase zijn bereikbaar"
        break
    fi
    if [ "$i" = "15" ]; then
        echo "❌ Deploy mislukt: services zijn niet bereikbaar"
        docker compose -f docker-compose.prod.yml ps
        exit 1
    fi
    sleep 2
done

echo ""

# 6. Show version
VERSION=$(grep '"version"' frontend/package.json | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
echo "✅ Deploy compleet! SetBaas v${VERSION} is live."
