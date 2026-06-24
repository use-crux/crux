package server

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

func projectNativeStaticDiscoveryCallNamesKey(callNames []string) string {
	names := append([]string(nil), projectNativeStaticDefaultCallNames...)
	names = append(names, callNames...)
	seen := map[string]bool{}
	out := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, name)
	}
	sort.Strings(out)
	data, _ := json.Marshal(out)
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum)
}

func projectNativeStaticDiscoveryClassificationKey(file string, callNamesKey string) string {
	data, _ := json.Marshal(struct {
		File         string `json:"file"`
		CallNamesKey string `json:"callNamesKey"`
		Version      string `json:"version"`
	}{
		File:         file,
		CallNamesKey: callNamesKey,
		Version:      projectNativeStaticClassifierCacheVersion,
	})
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum)
}
