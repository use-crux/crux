PNPM ?= pnpm

.PHONY: help
help:
	@echo "Crux targets:"
	@echo "  make install       Install workspace dependencies"
	@echo "  make dev           Run all dev tasks through Turbo"
	@echo "  make docs          Run the docs app"
	@echo "  make build         Build TypeScript packages/apps and the embedded CLI"
	@echo "  make build-js      Build TypeScript packages/apps through Turbo"
	@echo "  make cli           Build devtools workers/UI, embed them, then build the Go CLI"
	@echo "  make cli-go        Build only the Go CLI using currently embedded assets"
	@echo "  make cli-all       Build embedded CLI binaries for all supported platforms"
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
build: build-js cli

.PHONY: build-js
build-js:
	$(PNPM) build

.PHONY: cli
cli:
	$(MAKE) -C packages/crux-cli build

.PHONY: cli-go
cli-go:
	$(MAKE) -C packages/crux-cli build-go

.PHONY: cli-all
cli-all:
	$(MAKE) -C packages/crux-cli all

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
	$(MAKE) -C packages/crux-cli clean
