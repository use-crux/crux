package staticplan

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

var (
	projectNativeStaticSimpleNativeAstPattern = regexp.MustCompile(`(?s)\bnativeAst\s*:\s*(true|false|\{[^{}]*\})`)
	projectNativeStaticSimpleFrontendPattern  = regexp.MustCompile(`\bfrontend\s*:\s*['"]oxc['"]`)
	projectNativeStaticSimpleExtensionPattern = regexp.MustCompile(`\bextensions\s*:`)
	projectNativeStaticSimpleLintPattern      = regexp.MustCompile(`\blint\s*:`)
)

func InspectSimpleConfig(
	root string,
	configPath string,
) (devtools.ProjectNativeStaticConfig, bool, error) {
	configFile := projectNativeStaticResolveConfigFile(root, configPath)
	if configFile == "" {
		return devtools.ProjectNativeStaticConfig{}, false, nil
	}
	source, err := os.ReadFile(configFile)
	if err != nil {
		return devtools.ProjectNativeStaticConfig{}, false, nil
	}
	config, ok := ParseSimpleConfig(root, configFile, string(source))
	return config, ok, nil
}

func projectNativeStaticResolveConfigFile(root string, configPath string) string {
	if configPath != "" {
		if filepath.IsAbs(configPath) {
			return configPath
		}
		return filepath.Join(root, configPath)
	}
	return projectNativeStaticFindConfigFile(root)
}

func ParseSimpleConfig(
	root string,
	configFile string,
	source string,
) (devtools.ProjectNativeStaticConfig, bool) {
	if projectNativeStaticSimpleExtensionPattern.MatchString(source) ||
		projectNativeStaticSimpleLintPattern.MatchString(source) {
		return devtools.ProjectNativeStaticConfig{}, false
	}
	match := projectNativeStaticSimpleNativeAstPattern.FindStringSubmatch(source)
	if len(match) != 2 {
		return devtools.ProjectNativeStaticConfig{}, false
	}
	value := strings.TrimSpace(match[1])
	config := devtools.ProjectNativeStaticConfig{
		Root:        root,
		ConfigFile:  configFile,
		Extensions:  []devtools.ProjectNativeStaticExtensionReference{},
		Diagnostics: []devtools.ProjectNativeStaticConfigDiagnostic{},
	}
	switch value {
	case "true":
		config.NativeAstEnabled = true
		return config, true
	case "false":
		return config, true
	default:
		if !strings.HasPrefix(value, "{") || !strings.HasSuffix(value, "}") {
			return devtools.ProjectNativeStaticConfig{}, false
		}
		config.NativeAstEnabled = true
		if projectNativeStaticSimpleFrontendPattern.MatchString(value) {
			config.NativeAstFrontend = "oxc"
		}
		return config, true
	}
}
