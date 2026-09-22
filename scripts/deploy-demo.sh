#!/bin/bash
# SetBaas Demo Deploy Script
# Usage:
#   ./scripts/deploy_demo.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

COMPOSE_FILE="docker-compose.demo.yml"
ENV_FILE=".env.demo"
PROJECT_NAME="setbaas-demo"

echo "🏐 SetBaas Demo Deploy (demo.setbaas.nl)"
echo ""

# 0. Controleer of het env-bestand bestaat
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ Fout: $ENV_FILE ontbreekt in $PROJECT_DIR"
    exit 1
fi

# Zorg dat variabelen uit .env.demo expliciet in de shell geladen worden
# Dit voorkomt dat Compose terugvalt op de productie .env
set -a
source "$ENV_FILE"
set +a

# Wrapper shorthand voor docker compose
dc() {
    docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# 1. Build and deploy
echo "🔨 Stap 1: Build en deploy demo containers..."
dc build frontend
dc up -d

echo ""

# 2. Run setup (idempotent, schema migraties & superuser)
echo "⚙️  Stap 2: Database setup (schema migraties)..."
if dc config --profiles 2>/dev/null | grep -q setup; then
    dc --profile setup run --rm pb-setup || true
fi

echo ""

# 3. Verify services
echo "🔎 Stap 3: Demo services controleren..."
for i in $(seq 1 15); do
    if dc exec -T frontend \
        wget -q --spider http://127.0.0.1:3000 2>/dev/null \
        && dc exec -T pocketbase \
        wget -q --spider http://127.0.0.1:8090/api/health 2>/dev/null; then
        echo "  ✅ Demo Frontend en PocketBase zijn bereikbaar"
        break
    fi
    if [ "$i" = "15" ]; then
        echo "❌ Deploy mislukt: demo services zijn niet bereikbaar"
        dc ps
        exit 1
    fi
    sleep 2
done

echo ""

# 4. Show version
VERSION=$(grep '"version"' frontend/package.json | head -1 | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+')
echo "✅ Demo deploy compleet! SetBaas v${VERSION} is live op demo.setbaas.nl"