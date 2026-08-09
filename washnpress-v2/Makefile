# Wash N Press backend, common tasks.
.PHONY: install test run docker-up docker-down smoke

install:      ## Install dependencies
	npm ci

test:         ## Run all unit and functional tests
	npm test

run:          ## Run the app live (no Docker) on PORT (default 8080)
	npm start

docker-up:    ## Build and run the app in Docker (in-memory storage)
	docker compose up -d --build app
	@echo 'App starting in background. Check: curl localhost:$${HOST_PORT:-8080}/health'

docker-full:  ## Run the full stack (app + Postgres + Redis)
	docker compose --profile full up -d --build

docker-down:  ## Stop and remove Docker containers
	docker compose down

smoke:        ## Run the end-to-end smoke test against a running instance
	BASE_URL=$${BASE_URL:-http://localhost:8080} ./scripts/smoke-test.sh
