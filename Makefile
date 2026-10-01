.PHONY: help test demo prod down status logs seed clean up setup rebuild

# One entry point for every environment: ./scripts/deploy.sh <env> [command]
help:
	@echo "SetBaas deploy targets:"
	@echo "  make test    - deploy the test environment (localhost)"
	@echo "  make demo    - deploy the demo environment"
	@echo "  make prod    - deploy production"
	@echo "  make seed    - load demo data into the test environment"
	@echo "  make clean   - wipe the test database (clean install next time)"
	@echo "  make status ENV=test | down ENV=test | logs ENV=test"
	@echo ""
	@echo "Options are passed straight through, e.g.:"
	@echo "  ./scripts/deploy.sh prod --setup"

ENV ?= test

test:
	./scripts/deploy.sh test

demo:
	./scripts/deploy.sh demo

prod:
	./scripts/deploy.sh prod

seed:
	./scripts/deploy.sh test seed

clean:
	./scripts/deploy.sh test clean

down:
	./scripts/deploy.sh $(ENV) down

status:
	./scripts/deploy.sh $(ENV) status

logs:
	./scripts/deploy.sh $(ENV) logs

# === Legacy targets (plain docker-compose.yml dev stack) ===
up:
	docker compose up -d

setup:
	chmod +x scripts/setup-collections.sh
	@if [ -f .env ]; then set -a && . ./.env && set +a; fi && ./scripts/setup-collections.sh

rebuild:
	docker compose down
	docker compose build
	docker compose up -d
	@echo "Waiting for PocketBase to be healthy..."
	@sleep 5
	$(MAKE) setup
