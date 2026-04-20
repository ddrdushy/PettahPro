# PettahPro — dev shortcuts
.PHONY: help install up down clean logs build rebuild shell-api shell-db migrate studio reset

help:
	@echo "PettahPro dev targets:"
	@echo "  make install    Install pnpm deps locally (for IDE intellisense)"
	@echo "  make up         Start all services"
	@echo "  make down       Stop all services (volumes persist)"
	@echo "  make clean      Stop and delete all volumes (nukes DB)"
	@echo "  make logs       Tail all service logs"
	@echo "  make build      Build all Docker images"
	@echo "  make rebuild    Rebuild images from scratch (no cache)"
	@echo "  make shell-api  Open a shell in the API container"
	@echo "  make shell-db   Open psql in the Postgres container"
	@echo "  make migrate    Apply Drizzle migrations"
	@echo "  make studio     Open Drizzle Studio"
	@echo "  make reset      Full reset: clean + build + up + migrate"

install:
	pnpm install

up:
	docker compose up

down:
	docker compose down

clean:
	docker compose down -v

logs:
	docker compose logs -f

build:
	docker compose build

rebuild:
	docker compose build --no-cache

shell-api:
	docker compose exec api sh

shell-db:
	docker compose exec postgres psql -U pettahpro -d pettahpro

migrate:
	pnpm --filter @pettahpro/db migrate

studio:
	pnpm --filter @pettahpro/db studio

reset: clean build
	docker compose up -d
	@echo "Waiting for Postgres to be ready..."
	@until docker compose exec -T postgres pg_isready -U pettahpro -d pettahpro > /dev/null 2>&1; do sleep 1; done
	@$(MAKE) migrate
	@echo "Reset complete. Services are running."
