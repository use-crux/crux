package cache

import (
	"os"
	"strings"
)

const StatusEnv = "CRUX_INDEXER_STATIC_INDEX_CACHE_STATUS"

func StatusEnabledFromEnv() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv(StatusEnv)))
	return value != "0" && value != "false" && value != "off"
}
