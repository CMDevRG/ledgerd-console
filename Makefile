# ledgerd-console. `make help` lists the targets.
.DEFAULT_GOAL := help
.PHONY: help env up down logs smoke image verify

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-10s %s\n", $$1, $$2}'

env: ## Create .env with random secrets (only if it does not exist)
	@if [ -f .env ]; then echo ".env already exists; leaving it untouched"; else \
	  gen() { head -c 24 /dev/urandom | base64 | tr -d '/+=\n'; }; \
	  sed -e "s|^LEDGERD_API_KEY=.*|LEDGERD_API_KEY=$$(gen)$$(gen)|" \
	      -e "s|^POSTGRES_SUPERUSER_PASSWORD=.*|POSTGRES_SUPERUSER_PASSWORD=$$(gen)|" \
	      -e "s|^LEDGERD_OWNER_PASSWORD=.*|LEDGERD_OWNER_PASSWORD=$$(gen)|" \
	      -e "s|^LEDGERD_APP_PASSWORD=.*|LEDGERD_APP_PASSWORD=$$(gen)|" \
	      .env.example > .env && chmod 600 .env && echo "created .env with random secrets"; \
	fi

up: env ## Start PostgreSQL, ledgerd (release images) and the console; wait until healthy
	CONSOLE_VERSION=$$(git describe --tags --always --dirty 2>/dev/null || echo dev) \
	CONSOLE_COMMIT=$$(git rev-parse HEAD 2>/dev/null || echo unknown) \
	docker compose up --build --wait --detach
	@set -a; . ./.env; set +a; echo "console: http://localhost:$${CONSOLE_PORT:-8787}"

down: ## Stop the stack (keeps data); use `docker compose down -v` to delete it
	docker compose down

logs: ## Follow the console logs
	docker compose logs -f console

smoke: ## End-to-end check of the running stack
	./scripts/smoke.sh

image: ## Build only the console image
	docker build -t ledgerd-console:local .

verify: ## Type check, lint, tests, build and the build scans
	npm run verify
