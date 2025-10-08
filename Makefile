.PHONY: up logs down

up:
	@docker compose up -d

logs:
	@docker compose logs -f

down:
	@docker compose down
