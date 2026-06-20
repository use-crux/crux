VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := crux
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"
PNPM ?= pnpm
GO ?= go

DEVTOOLS_DIST := ../devtools/dist
DEVTOOLS_UI := ../devtools/ui/dist
EMBED_DIR := internal/server/embed
UI_EMBED_DIR := internal/server/ui-embed

$(EMBED_DIR) $(UI_EMBED_DIR) dist:
	mkdir -p $@

.PHONY: help
help:
	@echo "Crux Local targets:"
	@echo "  make build           Build devtools workers/UI, embed them, then build ./crux"
	@echo "  make build-devtools  Build bundled Node workers and React UI"
	@echo "  make embed           Copy built devtools assets into Go embed directories"
	@echo "  make build-go        Build only the Go binary using current embedded assets"
	@echo "  make all             Build devtools assets, embed them, then cross-compile all platforms"
	@echo "  make test            Run Go tests"
	@echo "  make clean           Remove local runtime build outputs"

.PHONY: build-devtools
build-devtools:
	cd ../.. && $(PNPM) --filter @crux/devtools build

.PHONY: embed
embed: embed-workers embed-ui

.PHONY: embed-workers
embed-workers: $(EMBED_DIR)
	@if [ -f "$(DEVTOOLS_DIST)/quality-runner.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/quality-runner.mjs" "$(EMBED_DIR)/quality-runner.mjs"; \
		echo "Embedded quality-runner.mjs from devtools dist"; \
	else \
		echo "Error: $(DEVTOOLS_DIST)/quality-runner.mjs not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/source-resolver.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/source-resolver.mjs" "$(EMBED_DIR)/source-resolver.mjs"; \
		echo "Embedded source-resolver.mjs from devtools dist"; \
	else \
		echo "Error: $(DEVTOOLS_DIST)/source-resolver.mjs not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/project-indexer.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/project-indexer.mjs" "$(EMBED_DIR)/project-indexer.mjs"; \
		echo "Embedded project-indexer.mjs from devtools dist"; \
	else \
		echo "Error: $(DEVTOOLS_DIST)/project-indexer.mjs not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/project-semantic-indexer.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/project-semantic-indexer.mjs" "$(EMBED_DIR)/project-semantic-indexer.mjs"; \
		echo "Embedded project-semantic-indexer.mjs from devtools dist"; \
	else \
		echo "Error: $(DEVTOOLS_DIST)/project-semantic-indexer.mjs not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/project-runtime-indexer.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/project-runtime-indexer.mjs" "$(EMBED_DIR)/project-runtime-indexer.mjs"; \
		echo "Embedded project-runtime-indexer.mjs from devtools dist"; \
	else \
		echo "Error: $(DEVTOOLS_DIST)/project-runtime-indexer.mjs not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi

.PHONY: embed-ui
embed-ui: $(UI_EMBED_DIR)
	@if [ -d "$(DEVTOOLS_UI)" ] && [ -f "$(DEVTOOLS_UI)/index.html" ]; then \
		rm -rf $(UI_EMBED_DIR)/*; \
		cp -r $(DEVTOOLS_UI)/* $(UI_EMBED_DIR)/; \
		echo "Embedded React UI from devtools ui/dist"; \
	else \
		echo "Error: $(DEVTOOLS_UI)/index.html not found"; \
		echo "Run 'make build-devtools' first"; \
		exit 1; \
	fi

.PHONY: build
build: build-devtools embed build-go

.PHONY: build-go
build-go:
	$(GO) build $(LDFLAGS) -o $(BINARY) ./cmd/crux/

.PHONY: all
all: build-devtools embed dist linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64 win32-arm64

.PHONY: linux-x64
linux-x64: dist
	mkdir -p dist/crux-linux-x64/bin
	GOOS=linux GOARCH=amd64 $(GO) build $(LDFLAGS) -o dist/crux-linux-x64/bin/crux ./cmd/crux/

.PHONY: linux-arm64
linux-arm64: dist
	mkdir -p dist/crux-linux-arm64/bin
	GOOS=linux GOARCH=arm64 $(GO) build $(LDFLAGS) -o dist/crux-linux-arm64/bin/crux ./cmd/crux/

.PHONY: darwin-x64
darwin-x64: dist
	mkdir -p dist/crux-darwin-x64/bin
	GOOS=darwin GOARCH=amd64 $(GO) build $(LDFLAGS) -o dist/crux-darwin-x64/bin/crux ./cmd/crux/

.PHONY: darwin-arm64
darwin-arm64: dist
	mkdir -p dist/crux-darwin-arm64/bin
	GOOS=darwin GOARCH=arm64 $(GO) build $(LDFLAGS) -o dist/crux-darwin-arm64/bin/crux ./cmd/crux/

.PHONY: win32-x64
win32-x64: dist
	mkdir -p dist/crux-win32-x64/bin
	GOOS=windows GOARCH=amd64 $(GO) build $(LDFLAGS) -o dist/crux-win32-x64/bin/crux.exe ./cmd/crux/

.PHONY: win32-arm64
win32-arm64: dist
	mkdir -p dist/crux-win32-arm64/bin
	GOOS=windows GOARCH=arm64 $(GO) build $(LDFLAGS) -o dist/crux-win32-arm64/bin/crux.exe ./cmd/crux/

.PHONY: clean
clean:
	rm -rf dist/ $(BINARY)

.PHONY: test
test:
	$(GO) test ./...

.PHONY: quality-go
quality-go:
	$(GO) test ./...
	$(GO) vet ./internal/observability ./internal/quality ./internal/store
	$(GO) test -race ./internal/store ./internal/observability

.PHONY: bench
bench:
	$(GO) test -run '^$$' -bench . -benchmem ./internal/observability ./internal/quality ./internal/store
