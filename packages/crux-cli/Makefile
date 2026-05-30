VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := crux
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"

DEVTOOLS_DIST := ../crux-devtools/dist
DEVTOOLS_UI := ../crux-devtools/ui/dist
EMBED_DIR := internal/server/embed
UI_EMBED_DIR := internal/server/ui-embed

# Copy bundled scripts from crux-devtools into the embed directory.
# Falls back to placeholders if devtools hasn't been built yet.
.PHONY: embed
embed: embed-workers embed-ui

.PHONY: embed-workers
embed-workers:
	@if [ -f "$(DEVTOOLS_DIST)/eval-runner.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/eval-runner.mjs" "$(EMBED_DIR)/eval-runner.mjs"; \
		echo "Embedded eval-runner.mjs from devtools dist"; \
	else \
		echo "Warning: $(DEVTOOLS_DIST)/eval-runner.mjs not found"; \
		echo "Run 'pnpm --filter @crux/devtools build' first"; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/source-resolver.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/source-resolver.mjs" "$(EMBED_DIR)/source-resolver.mjs"; \
		echo "Embedded source-resolver.mjs from devtools dist"; \
	fi
	@if [ -f "$(DEVTOOLS_DIST)/project-indexer.mjs" ]; then \
		cp "$(DEVTOOLS_DIST)/project-indexer.mjs" "$(EMBED_DIR)/project-indexer.mjs"; \
		echo "Embedded project-indexer.mjs from devtools dist"; \
	fi

.PHONY: embed-ui
embed-ui:
	@if [ -d "$(DEVTOOLS_UI)" ] && [ -f "$(DEVTOOLS_UI)/index.html" ]; then \
		rm -rf $(UI_EMBED_DIR)/*; \
		cp -r $(DEVTOOLS_UI)/* $(UI_EMBED_DIR)/; \
		echo "Embedded React UI from devtools ui/dist"; \
	else \
		echo "Warning: $(DEVTOOLS_UI)/index.html not found — UI will show fallback page"; \
		echo "Run 'pnpm --filter @crux/devtools build' first"; \
	fi

# Build for current platform
.PHONY: build
build: embed
	go build $(LDFLAGS) -o $(BINARY) ./cmd/crux/

# Cross-compile for all platforms
.PHONY: all
all: embed linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64 win32-arm64

.PHONY: linux-x64
linux-x64:
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o dist/crux-linux-x64/bin/crux ./cmd/crux/

.PHONY: linux-arm64
linux-arm64:
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/crux-linux-arm64/bin/crux ./cmd/crux/

.PHONY: darwin-x64
darwin-x64:
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o dist/crux-darwin-x64/bin/crux ./cmd/crux/

.PHONY: darwin-arm64
darwin-arm64:
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o dist/crux-darwin-arm64/bin/crux ./cmd/crux/

.PHONY: win32-x64
win32-x64:
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o dist/crux-win32-x64/bin/crux.exe ./cmd/crux/

.PHONY: win32-arm64
win32-arm64:
	GOOS=windows GOARCH=arm64 go build $(LDFLAGS) -o dist/crux-win32-arm64/bin/crux.exe ./cmd/crux/

.PHONY: clean
clean:
	rm -rf dist/ $(BINARY)

.PHONY: test
test:
	go test ./...

.PHONY: quality-go
quality-go:
	go test ./...
	go vet ./internal/observability ./internal/quality ./internal/store
	go test -race ./internal/store ./internal/observability

.PHONY: bench
bench:
	go test -run '^$$' -bench . -benchmem ./internal/observability ./internal/quality ./internal/store
