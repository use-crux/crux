package compat

import (
	"encoding/json"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

type Manifest struct {
	NativeOnlyEligible                  bool `json:"nativeOnlyEligible"`
	TypeScriptRuleCount                 int  `json:"typeScriptRuleCount"`
	RequiresTypeScriptHostForBundled    bool `json:"requiresTypeScriptHostForBundled"`
	RequiresTypeScriptHostForRules      bool `json:"requiresTypeScriptHostForRules"`
	RequiresTypeScriptHostForExtensions bool `json:"requiresTypeScriptHostForExtensions"`
	RequiresCompatibilityEvidence       bool `json:"requiresCompatibilityEvidence"`
}

func RequiresTypeScriptRules(plan projectindex.ProjectStaticSyntaxPlan) bool {
	host, ok := Decode(plan)
	return ok && (host.RequiresTypeScriptHostForRules || host.TypeScriptRuleCount > 0)
}

func NativeOnlyEligible(plan projectindex.ProjectStaticSyntaxPlan) bool {
	host, ok := Decode(plan)
	return ok &&
		host.NativeOnlyEligible &&
		!host.RequiresTypeScriptHostForBundled &&
		!host.RequiresTypeScriptHostForExtensions &&
		!host.RequiresTypeScriptHostForRules &&
		!host.RequiresCompatibilityEvidence
}

func Schedulable(plan projectindex.ProjectStaticSyntaxPlan) bool {
	host, ok := Decode(plan)
	return ok && !host.RequiresCompatibilityEvidence
}

func Decode(plan projectindex.ProjectStaticSyntaxPlan) (Manifest, bool) {
	raw := strings.TrimSpace(string(plan.StaticHost))
	if raw == "" || raw == "null" {
		return Manifest{}, false
	}
	var host Manifest
	if err := json.Unmarshal(plan.StaticHost, &host); err != nil {
		return Manifest{}, false
	}
	return host, true
}
