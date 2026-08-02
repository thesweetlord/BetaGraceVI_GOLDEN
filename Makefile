.PHONY: dev test check db db-push zip clean help

# ─── BetaGrace vI — Developer Makefile ───────────────────────────────────────
# Run `make help` to see all available commands.

# Colours
BOLD  := \033[1m
RESET := \033[0m
GREEN := \033[0;32m
CYAN  := \033[0;36m

help: ## Show this help message
	@echo ""
	@echo "$(BOLD)BetaGrace vI — Available Commands$(RESET)"
	@echo "────────────────────────────────────────────────────────"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-16s$(RESET) %s\n", $$1, $$2}'
	@echo ""

dev: ## Start the development server on http://localhost:5000
	npm run dev

check: ## Run TypeScript type-checker (zero-tolerance: must report 0 errors)
	npx tsc --noEmit

test: ## Run all 52 smoke tests against the local server
	@if [ -z "$$BASE_URL" ]; then \
		echo "$(BOLD)Running smoke tests against http://localhost:5000$(RESET)"; \
		BASE_URL=http://localhost:5000 npx tsx smoke-tests.ts; \
	else \
		echo "$(BOLD)Running smoke tests against $$BASE_URL$(RESET)"; \
		npx tsx smoke-tests.ts; \
	fi

test-remote: ## Run smoke tests against a custom URL: make test-remote URL=https://your-app.replit.app
	BASE_URL=$(URL) npx tsx smoke-tests.ts

db: ## Push the Drizzle schema to the database (creates missing tables, safe on fresh DB)
	npx drizzle-kit push

db-push: db ## Alias for `make db`

db-studio: ## Open Drizzle Studio (visual database explorer) at http://localhost:4983
	npx drizzle-kit studio

build: ## Build the production client bundle into dist/
	npm run build

start: ## Start the compiled production server (run `make build` first)
	npm run start

install: ## Install all npm dependencies
	npm install

audit: ## Run npm security audit
	npm audit

zip: ## Build a clean ZIP of the project (excludes node_modules, .env, dist, data, temp files)
	@echo "$(BOLD)Building BetAGrace_vI_release.zip...$(RESET)"
	@rm -f BetAGrace_vI_release.zip
	@zip -r BetAGrace_vI_release.zip . \
		--exclude "*.zip" \
		--exclude "node_modules/*" \
		--exclude ".env" \
		--exclude ".env.local" \
		--exclude "dist/*" \
		--exclude "data/*" \
		--exclude "temp_videos/*" \
		--exclude "temp_frames/*" \
		--exclude "attached_assets/generated_videos/*" \
		--exclude "*.log" \
		--exclude ".git/*" \
		--exclude "academic_artifact_*.md" \
		--exclude ".local/*"
	@echo "$(GREEN)Done: BetAGrace_vI_release.zip$(RESET)"
	@ls -lh BetAGrace_vI_release.zip

clean: ## Remove build artifacts, temp files, and the release ZIP
	@rm -rf dist/ temp_videos/ temp_frames/ BetAGrace_vI_release.zip
	@echo "$(GREEN)Cleaned build artifacts and temp files$(RESET)"

setup: ## Full first-time setup: install deps + push DB schema
	@echo "$(BOLD)Running first-time setup...$(RESET)"
	npm install
	npx drizzle-kit push
	@echo "$(GREEN)Setup complete. Copy .env.example to .env and fill in your values, then run: make dev$(RESET)"
