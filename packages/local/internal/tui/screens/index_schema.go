package screens

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type indexSchema struct {
	label string
	value map[string]any
}

type indexSchemaField struct {
	name        string
	fieldType   string
	required    bool
	description string
	depth       int
}

func (b *indexDocumentBuilder) renderSchemas() {
	schemas := definitionSchemas(b.definition.Metadata)
	if len(schemas) == 0 {
		return
	}
	b.section("CONTRACT")
	for _, schema := range schemas {
		b.lines = append(b.lines, " "+shell.TextMuted.Render(schema.label))
		for _, field := range schemaFields(schema.value) {
			required := "optional"
			if field.required {
				required = "required"
			}
			name := strings.Repeat("  ", field.depth) + sanitizeIndexInline(field.name)
			row := fmt.Sprintf("%s  %s  %s", name, sanitizeIndexInline(field.fieldType), required)
			if field.description != "" {
				row += "  — " + sanitizeIndexInline(field.description)
			}
			b.lines = append(b.lines, " "+shell.Text.Render(row))
		}
	}
}

func definitionSchemas(raw json.RawMessage) []indexSchema {
	var metadata map[string]any
	if len(raw) == 0 || json.Unmarshal(raw, &metadata) != nil {
		return nil
	}
	contract := nestedMap(metadata, "intelligence", "contract")
	candidates := []struct {
		key   string
		label string
	}{
		{key: "inputSchema", label: "INPUT"},
		{key: "outputSchema", label: "OUTPUT"},
		{key: "toolSchema", label: "TOOL"},
	}
	schemas := make([]indexSchema, 0, len(candidates))
	for _, candidate := range candidates {
		value, _ := metadata[candidate.key].(map[string]any)
		if value == nil {
			value, _ = contract[candidate.key].(map[string]any)
		}
		if value != nil {
			schemas = append(schemas, indexSchema{label: candidate.label, value: value})
		}
	}
	return schemas
}

func schemaFields(schema map[string]any) []indexSchemaField {
	properties, _ := schema["properties"].(map[string]any)
	if len(properties) == 0 {
		return []indexSchemaField{schemaField("$", schema, true, 0)}
	}
	required := stringSet(schema["required"])
	return objectSchemaFields(properties, required, 0)
}

func objectSchemaFields(properties map[string]any, required map[string]bool, depth int) []indexSchemaField {
	names := make([]string, 0, len(properties))
	for name := range properties {
		names = append(names, name)
	}
	slices.Sort(names)

	fields := make([]indexSchemaField, 0, len(names))
	for _, name := range names {
		value, _ := properties[name].(map[string]any)
		field := schemaField(name, value, required[name], depth)
		fields = append(fields, field)
		childSchema := value
		if schemaType(value) == "array<object>" {
			childSchema, _ = value["items"].(map[string]any)
		}
		children, _ := childSchema["properties"].(map[string]any)
		if len(children) > 0 {
			fields = append(fields, objectSchemaFields(children, stringSet(childSchema["required"]), depth+1)...)
		}
	}
	return fields
}

func schemaField(name string, schema map[string]any, required bool, depth int) indexSchemaField {
	description, _ := schema["description"].(string)
	return indexSchemaField{
		name: name, fieldType: schemaType(schema), required: required,
		description: description, depth: depth,
	}
}

func schemaType(schema map[string]any) string {
	if schema == nil {
		return "unknown"
	}
	value, _ := schema["type"].(string)
	if value == "array" {
		item, _ := schema["items"].(map[string]any)
		return "array<" + schemaType(item) + ">"
	}
	if value != "" {
		return value
	}
	if enum, ok := schema["enum"].([]any); ok && len(enum) > 0 {
		return "enum"
	}
	for _, key := range []string{"oneOf", "anyOf", "allOf"} {
		if variants, ok := schema[key].([]any); ok && len(variants) > 0 {
			return key
		}
	}
	return "unknown"
}

func stringSet(value any) map[string]bool {
	set := map[string]bool{}
	for _, item := range anySlice(value) {
		if text, ok := item.(string); ok {
			set[text] = true
		}
	}
	return set
}

func nestedMap(root map[string]any, keys ...string) map[string]any {
	current := root
	for _, key := range keys {
		next, _ := current[key].(map[string]any)
		if next == nil {
			return nil
		}
		current = next
	}
	return current
}

func anySlice(value any) []any {
	items, _ := value.([]any)
	return items
}
