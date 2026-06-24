package staticplan

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/use-crux/crux/packages/local/internal/devtools"
)

type projectNativeStaticInterestManifest struct {
	Calls         []devtools.StaticCallInterest        `json:"calls,omitempty"`
	Constructors  []devtools.StaticConstructorInterest `json:"constructors,omitempty"`
	Definitions   []string                             `json:"definitions,omitempty"`
	Relations     []string                             `json:"relations,omitempty"`
	Compatibility json.RawMessage                      `json:"compatibility,omitempty"`
}

type projectNativeStaticHostPlan struct {
	Extractors                          []json.RawMessage `json:"extractors,omitempty"`
	BundledNativeExtractorCount         int               `json:"bundledNativeExtractorCount"`
	BundledTypeScriptExtractorCount     int               `json:"bundledTypeScriptExtractorCount"`
	ExtensionTypeScriptExtractorCount   int               `json:"extensionTypeScriptExtractorCount"`
	TypeScriptRuleCount                 int               `json:"typeScriptRuleCount"`
	RequiresTypeScriptHostForBundled    bool              `json:"requiresTypeScriptHostForBundled"`
	RequiresTypeScriptHostForExtensions bool              `json:"requiresTypeScriptHostForExtensions"`
	RequiresTypeScriptHostForRules      bool              `json:"requiresTypeScriptHostForRules"`
	RequiresCompatibilityEvidence       bool              `json:"requiresCompatibilityEvidence"`
	CompatibilityReason                 string            `json:"compatibilityReason,omitempty"`
	NativeOnlyEligible                  bool              `json:"nativeOnlyEligible"`
}

func projectNativeStaticMergeExtensionHostManifest(
	plan *devtools.ProjectStaticSyntaxPlan,
	result devtools.StaticExtensionHostManifestResult,
) error {
	plan.CallNames = sortedUniqueStrings(append(plan.CallNames, result.Manifest.CallNames...))
	if merged, ok, err := projectNativeStaticMergeInterests(plan.StaticInterests, result.Manifest.StaticInterests); err != nil {
		return err
	} else if ok {
		plan.StaticInterests = merged
		extensionInterests, err := projectNativeStaticDecodeInterests(result.Manifest.StaticInterests)
		if err != nil {
			return err
		}
		plan.CallInterests = projectNativeStaticUniqueCallInterests(append(plan.CallInterests, extensionInterests.Calls...))
		plan.ConstructorInterests = projectNativeStaticUniqueConstructorInterests(append(plan.ConstructorInterests, extensionInterests.Constructors...))
		for _, interest := range extensionInterests.Constructors {
			plan.ConstructorNames = append(plan.ConstructorNames, interest.Name)
		}
		plan.ConstructorNames = sortedUniqueStrings(plan.ConstructorNames)
	}
	if merged, ok, err := projectNativeStaticMergeStaticHost(plan.StaticHost, result.Manifest.StaticHost); err != nil {
		return err
	} else if ok {
		plan.StaticHost = merged
	}
	if projectNativeStaticJSONArrayHasItems(result.Manifest.RelationSpecs) {
		plan.RelationSpecs = append(json.RawMessage(nil), result.Manifest.RelationSpecs...)
	}
	if projectNativeStaticJSONArrayHasItems(result.RuleDescriptors) {
		plan.RuleDescriptors = append(json.RawMessage(nil), result.RuleDescriptors...)
	}
	if len(result.CacheInputs) > 0 {
		plan.CacheInputs = append([]json.RawMessage(nil), result.CacheInputs...)
	} else if len(result.Manifest.CacheInputs) > 0 {
		plan.CacheInputs = append(plan.CacheInputs, result.Manifest.CacheInputs...)
	}
	return nil
}

func projectNativeStaticMergeInterests(
	baseRaw json.RawMessage,
	extensionRaw json.RawMessage,
) (json.RawMessage, bool, error) {
	if len(bytes.TrimSpace(extensionRaw)) == 0 {
		return nil, false, nil
	}
	base, err := projectNativeStaticDecodeInterests(baseRaw)
	if err != nil {
		return nil, false, err
	}
	extension, err := projectNativeStaticDecodeInterests(extensionRaw)
	if err != nil {
		return nil, false, err
	}
	merged := projectNativeStaticInterestManifest{
		Calls:         projectNativeStaticUniqueCallInterests(append(base.Calls, extension.Calls...)),
		Constructors:  projectNativeStaticUniqueConstructorInterests(append(base.Constructors, extension.Constructors...)),
		Definitions:   sortedUniqueStrings(append(base.Definitions, extension.Definitions...)),
		Relations:     sortedUniqueStrings(append(base.Relations, extension.Relations...)),
		Compatibility: base.Compatibility,
	}
	if len(bytes.TrimSpace(extension.Compatibility)) > 0 {
		merged.Compatibility = append(json.RawMessage(nil), extension.Compatibility...)
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return nil, false, fmt.Errorf("encode native static merged interests: %w", err)
	}
	return data, true, nil
}

func projectNativeStaticDecodeInterests(raw json.RawMessage) (projectNativeStaticInterestManifest, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return projectNativeStaticInterestManifest{}, nil
	}
	var interests projectNativeStaticInterestManifest
	if err := json.Unmarshal(raw, &interests); err != nil {
		return projectNativeStaticInterestManifest{}, fmt.Errorf("decode native static interests: %w", err)
	}
	return interests, nil
}

func projectNativeStaticMergeStaticHost(
	baseRaw json.RawMessage,
	extensionRaw json.RawMessage,
) (json.RawMessage, bool, error) {
	if len(bytes.TrimSpace(extensionRaw)) == 0 {
		return nil, false, nil
	}
	var base projectNativeStaticHostPlan
	if err := json.Unmarshal(baseRaw, &base); err != nil {
		return nil, false, fmt.Errorf("decode native static host: %w", err)
	}
	var extension projectNativeStaticHostPlan
	if err := json.Unmarshal(extensionRaw, &extension); err != nil {
		return nil, false, fmt.Errorf("decode extension static host: %w", err)
	}
	merged := projectNativeStaticHostPlan{
		Extractors:                          append(append([]json.RawMessage{}, base.Extractors...), extension.Extractors...),
		BundledNativeExtractorCount:         base.BundledNativeExtractorCount + extension.BundledNativeExtractorCount,
		BundledTypeScriptExtractorCount:     base.BundledTypeScriptExtractorCount + extension.BundledTypeScriptExtractorCount,
		ExtensionTypeScriptExtractorCount:   base.ExtensionTypeScriptExtractorCount + extension.ExtensionTypeScriptExtractorCount,
		TypeScriptRuleCount:                 base.TypeScriptRuleCount + extension.TypeScriptRuleCount,
		RequiresTypeScriptHostForBundled:    base.RequiresTypeScriptHostForBundled || extension.RequiresTypeScriptHostForBundled,
		RequiresTypeScriptHostForExtensions: base.RequiresTypeScriptHostForExtensions || extension.RequiresTypeScriptHostForExtensions,
		RequiresTypeScriptHostForRules:      base.RequiresTypeScriptHostForRules || extension.RequiresTypeScriptHostForRules,
		RequiresCompatibilityEvidence:       base.RequiresCompatibilityEvidence || extension.RequiresCompatibilityEvidence,
		CompatibilityReason:                 base.CompatibilityReason,
		NativeOnlyEligible:                  base.NativeOnlyEligible && extension.NativeOnlyEligible,
	}
	if extension.CompatibilityReason != "" {
		merged.CompatibilityReason = extension.CompatibilityReason
	}
	data, err := json.Marshal(merged)
	if err != nil {
		return nil, false, fmt.Errorf("encode native static merged host: %w", err)
	}
	return data, true, nil
}

func projectNativeStaticUniqueCallInterests(input []devtools.StaticCallInterest) []devtools.StaticCallInterest {
	byKey := make(map[string]devtools.StaticCallInterest, len(input))
	for _, interest := range input {
		interest.ImportFrom = sortedUniqueStrings(interest.ImportFrom)
		byKey[projectNativeStaticInterestKey(interest.Name, interest.ImportFrom)] = interest
	}
	out := make([]devtools.StaticCallInterest, 0, len(byKey))
	for _, interest := range byKey {
		out = append(out, interest)
	}
	sort.Slice(out, func(i, j int) bool {
		return projectNativeStaticInterestKey(out[i].Name, out[i].ImportFrom) < projectNativeStaticInterestKey(out[j].Name, out[j].ImportFrom)
	})
	return out
}

func projectNativeStaticUniqueConstructorInterests(input []devtools.StaticConstructorInterest) []devtools.StaticConstructorInterest {
	byKey := make(map[string]devtools.StaticConstructorInterest, len(input))
	for _, interest := range input {
		interest.ImportFrom = sortedUniqueStrings(interest.ImportFrom)
		byKey[projectNativeStaticInterestKey(interest.Name, interest.ImportFrom)] = interest
	}
	out := make([]devtools.StaticConstructorInterest, 0, len(byKey))
	for _, interest := range byKey {
		out = append(out, interest)
	}
	sort.Slice(out, func(i, j int) bool {
		return projectNativeStaticInterestKey(out[i].Name, out[i].ImportFrom) < projectNativeStaticInterestKey(out[j].Name, out[j].ImportFrom)
	})
	return out
}

func projectNativeStaticInterestKey(name string, imports []string) string {
	return name + "\x00" + fmt.Sprint(imports)
}

func projectNativeStaticJSONArrayHasItems(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return false
	}
	var values []json.RawMessage
	return json.Unmarshal(raw, &values) == nil && len(values) > 0
}

func sortedUniqueStrings(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(input))
	for _, value := range input {
		if value != "" {
			set[value] = struct{}{}
		}
	}
	out := make([]string, 0, len(set))
	for value := range set {
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}
