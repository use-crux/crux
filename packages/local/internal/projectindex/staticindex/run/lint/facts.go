package lint

import (
	"encoding/json"
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/store"
)

func RequiresTypeScriptRules(index store.IndexData) bool {
	for _, descriptor := range index.RuleDescriptors {
		if descriptor.Source == "extension" || descriptor.Extension != nil {
			return true
		}
	}
	return false
}

func Facts(root, projectName string, index store.IndexData) ([]json.RawMessage, error) {
	facts := []json.RawMessage{}
	if marker, err := json.Marshal(map[string]string{"root": root, "projectName": projectName}); err != nil {
		return nil, err
	} else {
		facts = append(facts, marker)
	}
	if index.Project != nil {
		if fact, ok, err := groupedJSONFact("project", index.Project); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.Definitions) > 0 {
		if fact, ok, err := groupedJSONFact("definitions", index.Definitions); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.Relations) > 0 {
		if fact, ok, err := groupedJSONFact("relations", index.Relations); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.RuleDescriptors) > 0 {
		if fact, ok, err := groupedJSONFact("ruleDescriptors", index.RuleDescriptors); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(index.Sources) > 0 {
		if fact, ok, err := groupedJSONFact("sources", index.Sources); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if index.SourceGraph != nil {
		if fact, ok, err := groupedJSONFact("sourceGraph", index.SourceGraph); err != nil {
			return nil, err
		} else if ok {
			facts = append(facts, fact)
		}
	}
	if len(facts) == 1 {
		return nil, nil
	}
	return facts, nil
}

func Config(index store.IndexData) (json.RawMessage, error) {
	if index.Lint == nil {
		return nil, nil
	}
	data, err := json.Marshal(index.Lint)
	if err != nil {
		return nil, fmt.Errorf("marshal Static Index lint config: %w", err)
	}
	return data, nil
}

func Files(index store.IndexData) []string {
	files := make([]string, 0, len(index.Sources)+len(index.Definitions))
	seen := map[string]bool{}
	add := func(file string) {
		if file == "" || seen[file] {
			return
		}
		seen[file] = true
		files = append(files, file)
	}
	for _, source := range index.Sources {
		add(source.File)
	}
	for _, definition := range index.Definitions {
		if definition.Source != nil {
			add(definition.Source.File)
		}
		for _, ref := range definition.SourceRefs {
			add(ref.Source.File)
		}
	}
	return files
}

func groupedJSONFact(key string, value any) (json.RawMessage, bool, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, false, fmt.Errorf("marshal Static Index lint %s facts: %w", key, err)
	}
	return groupedFact(key, raw)
}

func groupedFact(key string, value json.RawMessage) (json.RawMessage, bool, error) {
	data, err := json.Marshal(map[string]json.RawMessage{key: value})
	if err != nil {
		return nil, false, fmt.Errorf("Static Index grouped %s facts: %w", key, err)
	}
	return data, true, nil
}
