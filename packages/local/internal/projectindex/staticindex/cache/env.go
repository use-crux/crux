package cache

import (
	"os"
	"strings"
)

const StatusEnv = "CRUX_INDEXER_NATIVE_STATIC_CACHE_STATUS"

func StatusEnabledFromEnv() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(StatusEnv)))
	return value != "0" && value != "false" && value != "off"
}
