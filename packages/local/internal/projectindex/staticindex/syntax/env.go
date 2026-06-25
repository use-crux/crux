package syntax

import (
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

const syntaxWorkerEnv = "CRUX_STATIC_INDEX_WORKER"
const syntaxWorkerPoolSizeEnv = "CRUX_STATIC_INDEX_WORKER_POOL_SIZE"

const WorkerEnv = syntaxWorkerEnv
const PoolSizeEnv = syntaxWorkerPoolSizeEnv

var osExecutable = os.Executable

func CommandPathFromEnv() (string, bool) {
	return syntaxWorkerCommandPath()
}

func UseAdaptivePoolFromEnv() bool {
	return strings.TrimSpace(os.Getenv(syntaxWorkerPoolSizeEnv)) == ""
}

func PoolSizeFromEnv() int {
	return syntaxWorkerPoolSizeFromEnv()
}

func DefaultPoolSize() int {
	return defaultPoolSize()
}

func syntaxWorkerCommandPath() (string, bool) {
	if explicit := strings.TrimSpace(os.Getenv(syntaxWorkerEnv)); explicit != "" {
		return explicit, true
	}
	executable, err := osExecutable()
	if err != nil || executable == "" {
		return "", false
	}
	candidate := filepath.Join(filepath.Dir(executable), syntaxWorkerBinaryName())
	info, err := os.Stat(candidate)
	if err != nil || info.IsDir() {
		return "", false
	}
	return candidate, true
}

func syntaxWorkerBinaryName() string {
	if runtime.GOOS == "windows" {
		return "crux-indexer-worker.exe"
	}
	return "crux-indexer-worker"
}

func syntaxWorkerPoolSizeFromEnv() int {
	explicit := strings.TrimSpace(os.Getenv(syntaxWorkerPoolSizeEnv))
	if explicit == "" {
		return defaultPoolSize()
	}
	size, err := strconv.Atoi(explicit)
	if err != nil || size < 1 {
		slog.Warn("invalid project indexer worker pool size", "env", syntaxWorkerPoolSizeEnv, "value", explicit)
		return defaultPoolSize()
	}
	return size
}

func defaultPoolSize() int {
	size := runtime.GOMAXPROCS(0)
	if size < 1 {
		return 1
	}
	if size > 4 {
		return 4
	}
	return size
}
