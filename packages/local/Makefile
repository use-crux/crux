VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BINARY := crux
LDFLAGS := -ldflags "-s -w -X main.version=$(VERSION)"
PNPM ?= pnpm
GO ?= go
CARGO ?= cargo
RUSTUP ?= rustup

DEVTOOLS_DIST := ../devtools/dist
DEVTOOLS_UI := ../devtools/ui/dist
EMBED_DIR := internal/assets/embed
UI_EMBED_DIR := internal/assets/ui-embed
INDEXER_WORKER_MANIFEST := ../../Cargo.toml
INDEXER_WORKER_TARGET_DIR := ../../target
HOST_EXE_EXT := $(if $(filter Windows_NT,$(OS)),.exe,)
INDEXER_WORKER_BIN := crux-indexer-worker
INDEXER_WORKER_BINARY := $(INDEXER_WORKER_BIN)$(HOST_EXE_EXT)
LOCAL_ALL_RUST_TARGETS := x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu x86_64-apple-darwin aarch64-apple-darwin x86_64-pc-windows-gnu aarch64-pc-windows-gnullvm
LOCAL_ALL_REQUIRED_TOOLS := $(GO) $(CARGO) $(RUSTUP)
CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER ?= aarch64-linux-gnu-gcc
CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER ?= x86_64-w64-mingw32-gcc
CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER ?= aarch64-w64-mingw32-clang
LOCAL_ALL_REQUIRED_LINKERS := $(CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER) $(CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER) $(CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER)
LOCAL_ALL_HOST_GOOS := $(shell $(GO) env GOOS 2>/dev/null || uname -s | tr '[:upper:]' '[:lower:]')
LOCAL_ALL_DARWIN_CROSS_OK ?= $(if $(filter darwin,$(LOCAL_ALL_HOST_GOOS)),1,0)

export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER
export CARGO_TARGET_AARCH64_PC_WINDOWS_GNULLVM_LINKER

$(EMBED_DIR) $(UI_EMBED_DIR) dist:
	mkdir -p $@

.PHONY: help
help:
	@echo "Crux Local targets:"
	@echo "  make build           Build devtools workers/UI, embed them, then build ./crux"
	@echo "  make build-devtools  Build bundled Node workers and React UI"
	@echo "  make build-indexer-worker  Build the current-platform Rust/Oxc indexer worker"
	@echo "  make embed           Copy built devtools assets into Go embed directories"
	@echo "  make build-go        Build only the Go binary using current embedded assets"
	@echo "  make all             Build devtools assets, embed them, then package all platform binaries"
	@echo "  make check-local-all-toolchain  Verify Rust targets/linkers for all platform bundles"
	@echo "  make test            Run Go tests"
	@echo "  make clean           Remove local runtime build outputs"

.PHONY: build-devtools
build-devtools:
	cd ../.. && $(PNPM) --filter @use-crux/devtools build

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

.PHONY: build-indexer-worker
build-indexer-worker:
	$(CARGO) build --release --manifest-path "$(INDEXER_WORKER_MANIFEST)" --package crux-indexer-worker --bin $(INDEXER_WORKER_BIN)
	cp "$(INDEXER_WORKER_TARGET_DIR)/release/$(INDEXER_WORKER_BINARY)" "$(INDEXER_WORKER_BINARY)"

.PHONY: build
build: build-devtools embed build-indexer-worker build-go

.PHONY: build-go
build-go:
	$(GO) build $(LDFLAGS) -o $(BINARY) ./cmd/crux/

.PHONY: all
all: check-local-all-toolchain build-devtools embed dist linux-x64 linux-arm64 darwin-x64 darwin-arm64 win32-x64 win32-arm64

.PHONY: check-local-all-toolchain
check-local-all-toolchain:
	@missing=0; \
	for tool in $(LOCAL_ALL_REQUIRED_TOOLS); do \
		if ! command -v "$$tool" >/dev/null 2>&1; then \
			echo "Missing required tool for make local-all: $$tool"; \
			missing=1; \
		fi; \
	done; \
	for linker in $(LOCAL_ALL_REQUIRED_LINKERS); do \
		if ! command -v "$$linker" >/dev/null 2>&1; then \
			echo "Missing cross linker for make local-all: $$linker"; \
			missing=1; \
		fi; \
	done; \
	if [ "$(LOCAL_ALL_DARWIN_CROSS_OK)" != "1" ]; then \
		echo "Darwin Rust platform bundles need a Darwin host or configured Apple SDK cross linkers."; \
		echo "Set LOCAL_ALL_DARWIN_CROSS_OK=1 only after configuring Cargo linkers for x86_64-apple-darwin and aarch64-apple-darwin."; \
		missing=1; \
	fi; \
	installed_targets="$$($(RUSTUP) target list --installed 2>/dev/null || true)"; \
	for target in $(LOCAL_ALL_RUST_TARGETS); do \
		if ! printf '%s\n' "$$installed_targets" | grep -qx "$$target"; then \
			echo "Missing Rust target for make local-all: $$target"; \
			echo "  $(RUSTUP) target add $$target"; \
			missing=1; \
		fi; \
	done; \
	if [ "$$missing" -ne 0 ]; then \
		echo "make local-all cannot run until the required toolchain pieces are installed."; \
		echo "Non-host targets may also require target-specific C linkers or SDKs after Rust std libraries are installed."; \
		exit 1; \
	fi

define PLATFORM_TARGET
.PHONY: $(1)
$(1): dist
	mkdir -p dist/crux-$(1)/bin
	GOOS=$(2) GOARCH=$(3) $(GO) build $(LDFLAGS) -o dist/crux-$(1)/bin/crux$(5) ./cmd/crux/
	$(CARGO) build --release --manifest-path "$(INDEXER_WORKER_MANIFEST)" --package crux-indexer-worker --bin $(INDEXER_WORKER_BIN) --target "$(4)"
	cp "$(INDEXER_WORKER_TARGET_DIR)/$(4)/release/$(INDEXER_WORKER_BIN)$(5)" "dist/crux-$(1)/bin/$(INDEXER_WORKER_BIN)$(5)"
endef

$(eval $(call PLATFORM_TARGET,linux-x64,linux,amd64,x86_64-unknown-linux-gnu,))
$(eval $(call PLATFORM_TARGET,linux-arm64,linux,arm64,aarch64-unknown-linux-gnu,))
$(eval $(call PLATFORM_TARGET,darwin-x64,darwin,amd64,x86_64-apple-darwin,))
$(eval $(call PLATFORM_TARGET,darwin-arm64,darwin,arm64,aarch64-apple-darwin,))
$(eval $(call PLATFORM_TARGET,win32-x64,windows,amd64,x86_64-pc-windows-gnu,.exe))
$(eval $(call PLATFORM_TARGET,win32-arm64,windows,arm64,aarch64-pc-windows-gnullvm,.exe))

.PHONY: clean
clean:
	rm -rf dist/ $(BINARY) $(INDEXER_WORKER_BINARY)

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
