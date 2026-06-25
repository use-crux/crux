package planner

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

var (
	simpleNativeAstPattern = regexp.MustCompile(`(?s)\bnativeAst\s*:\s*(true|false|\{[^{}]*\})`)
	simpleFrontendPattern  = regexp.MustCompile(`\bfrontend\s*:\s*['"]oxc['"]`)
	simpleExtensionPattern = regexp.MustCompile(`\bextensions\s*:`)
	simpleLintPattern      = regexp.MustCompile(`\blint\s*:`)
)

func InspectSimpleConfig(
	root string,
	configPath string,
) (projectindex.ProjectStaticIndexConfig, bool, error) {
	configFile := resolveConfigFile(root, configPath)
	if configFile == "" {
		return projectindex.ProjectStaticIndexConfig{}, false, nil
	}
	source, err := os.ReadFile(configFile)
	if err != nil {
		return projectindex.ProjectStaticIndexConfig{}, false, nil
	}
	config, ok := ParseSimpleConfig(root, configFile, string(source))
	return config, ok, nil
}

func resolveConfigFile(root string, configPath string) string {
	if configPath != "" {
		if filepath.IsAbs(configPath) {
			return configPath
		}
		return filepath.Join(root, configPath)
	}
	return findConfigFile(root)
}

func ParseSimpleConfig(
	root string,
	configFile string,
	source string,
) (projectindex.ProjectStaticIndexConfig, bool) {
	if simpleExtensionPattern.MatchString(source) ||
		simpleLintPattern.MatchString(source) {
		return projectindex.ProjectStaticIndexConfig{}, false
	}
	match := simpleNativeAstPattern.FindStringSubmatch(source)
	if len(match) != 2 {
		return projectindex.ProjectStaticIndexConfig{}, false
	}
	value := strings.TrimSpace(match[1])
	config := projectindex.ProjectStaticIndexConfig{
		Root:        root,
		ConfigFile:  configFile,
		Extensions:  []projectindex.ProjectStaticIndexExtensionReference{},
		Diagnostics: []projectindex.ProjectStaticIndexConfigDiagnostic{},
	}
	switch value {
	case "true":
		config.NativeAstEnabled = true
		return config, true
	case "false":
		return config, true
	default:
		if !strings.HasPrefix(value, "{") || !strings.HasSuffix(value, "}") {
			return projectindex.ProjectStaticIndexConfig{}, false
		}
		config.NativeAstEnabled = true
		if simpleFrontendPattern.MatchString(value) {
			config.NativeAstFrontend = "oxc"
		}
		return config, true
	}
}
