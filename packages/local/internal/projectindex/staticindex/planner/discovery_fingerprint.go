package planner

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"time"
)

type discoveryFileFingerprint struct {
	Size               int64  `json:"size"`
	ModTimeUnixNano    int64  `json:"modTimeUnixNano"`
	ChangeTimeUnixNano int64  `json:"changeTimeUnixNano,omitempty"`
	ContentSampleHash  string `json:"contentSampleHash,omitempty"`
}

type discoveryPathState struct {
	File               string `json:"file"`
	Exists             bool   `json:"exists"`
	IsDir              bool   `json:"isDir,omitempty"`
	SourceFile         bool   `json:"sourceFile,omitempty"`
	Size               int64  `json:"size,omitempty"`
	ModTimeUnixNano    int64  `json:"modTimeUnixNano,omitempty"`
	ChangeTimeUnixNano int64  `json:"changeTimeUnixNano,omitempty"`
}

func discoveryFingerprint(file string) (discoveryFileFingerprint, bool) {
	info, err := os.Stat(file)
	if err != nil || info.IsDir() {
		return discoveryFileFingerprint{}, false
	}
	sampleHash, ok := discoveryContentSampleHash(file, minInt64(info.Size(), sampleBytes))
	if !ok {
		return discoveryFileFingerprint{}, false
	}
	return discoveryFileFingerprint{
		Size:               info.Size(),
		ModTimeUnixNano:    info.ModTime().UnixNano(),
		ChangeTimeUnixNano: changeTimeUnixNano(info),
		ContentSampleHash:  sampleHash,
	}, true
}

func discoveryContentSampleHash(file string, bytes int64) (string, bool) {
	hash := sha256.New()
	if bytes <= 0 {
		return hex.EncodeToString(hash.Sum(nil)), true
	}
	handle, err := os.Open(file)
	if err != nil {
		return "", false
	}
	defer handle.Close()
	if _, err := io.CopyN(hash, handle, bytes); err != nil && err != io.EOF {
		return "", false
	}
	return hex.EncodeToString(hash.Sum(nil)), true
}

func changeTimeUnixNano(info os.FileInfo) int64 {
	if info == nil || info.Sys() == nil {
		return 0
	}
	value := reflect.ValueOf(info.Sys())
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return 0
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return 0
	}
	for _, name := range []string{"Ctim", "Ctimespec"} {
		field := value.FieldByName(name)
		if timestamp, ok := unixTimeField(field); ok {
			return timestamp
		}
	}
	return 0
}

func unixTimeField(value reflect.Value) (int64, bool) {
	if !value.IsValid() {
		return 0, false
	}
	if value.Kind() == reflect.Pointer {
		if value.IsNil() {
			return 0, false
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		return 0, false
	}
	sec, ok := intField(value, "Sec")
	if !ok {
		return 0, false
	}
	nsec, ok := intField(value, "Nsec")
	if !ok {
		return 0, false
	}
	return sec*int64(time.Second) + nsec, true
}

func intField(value reflect.Value, name string) (int64, bool) {
	field := value.FieldByName(name)
	if !field.IsValid() {
		return 0, false
	}
	switch field.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return field.Int(), true
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		unsigned := field.Uint()
		if unsigned > uint64(^uint64(0)>>1) {
			return 0, false
		}
		return int64(unsigned), true
	default:
		return 0, false
	}
}

func readDiscoveryPathState(root string, file string) discoveryPathState {
	state := discoveryPathState{File: filepath.ToSlash(file)}
	if root != "" {
		if relative, err := filepath.Rel(root, file); err == nil {
			state.File = filepath.ToSlash(relative)
		}
	}
	info, err := os.Stat(file)
	if err != nil {
		return state
	}
	state.Exists = true
	state.IsDir = info.IsDir()
	state.SourceFile = !info.IsDir() && candidateSourceFile(file)
	state.Size = info.Size()
	state.ModTimeUnixNano = info.ModTime().UnixNano()
	state.ChangeTimeUnixNano = changeTimeUnixNano(info)
	return state
}

func discoveryPathStateMatches(root string, expected discoveryPathState) bool {
	file := expected.File
	if root != "" && !filepath.IsAbs(file) {
		file = filepath.Join(root, filepath.FromSlash(file))
	}
	return readDiscoveryPathState(root, file) == expected
}
