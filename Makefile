PNPM ?= pnpm

.PHONY: help
help:
	@echo "Crux targets:"
	@echo "  make install       Install workspace dependencies"
	@echo "  make dev           Run all dev tasks through Turbo"
	@echo "  make docs          Run the docs app"
	@echo "  make build         Build devtools, Rust indexer worker, embeds, then Crux Local"
	@echo "  make build-js      Build devtools workers and UI only"
	@echo "  make local         Build devtools, Rust indexer worker, embeds, then Crux Local"
	@echo "  make local-go      Build only Crux Local using currently embedded assets"
	@echo "  make local-all     Build embedded Crux Local binaries for all supported platforms"
	@echo "  make cli           Alias for make local"
	@echo "  make test          Run workspace tests"
	@echo "  make typecheck     Run workspace typechecks"
	@echo "  make clean         Remove common build outputs"

.PHONY: install
install:
	$(PNPM) install

.PHONY: dev
dev:
	$(PNPM) dev

.PHONY: docs
docs:
	$(PNPM) dev:docs

.PHONY: build
build: local

.PHONY: build-js
build-js:
	$(PNPM) --filter @crux/devtools build

.PHONY: local
local:
	$(MAKE) -C packages/local build

.PHONY: local-go
local-go:
	$(MAKE) -C packages/local build-go

.PHONY: local-all
local-all:
	$(MAKE) -C packages/local all

.PHONY: cli
cli: local

.PHONY: cli-go
cli-go: local-go

.PHONY: cli-all
cli-all: local-all

.PHONY: test
test:
	$(PNPM) test

.PHONY: typecheck
typecheck:
	$(PNPM) typecheck

.PHONY: clean
clean:
	rm -rf node_modules .turbo
	find packages apps -type d \( -name dist -o -name .next -o -name .turbo \) -prune -exec rm -rf {} +
	$(MAKE) -C packages/local clean
