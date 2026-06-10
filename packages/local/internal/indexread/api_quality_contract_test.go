package indexread

import (
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestIndexQualityJSONFieldsMatchAPIType(t *testing.T) {
	storeFields := jsonFields(reflect.TypeOf(store.IndexQuality{}))
	apiFields := jsonFields(reflect.TypeOf(api.IndexQuality{}))
	if !reflect.DeepEqual(storeFields, apiFields) {
		t.Fatalf("IndexQuality JSON fields differ\nstore: %#v\napi:   %#v", storeFields, apiFields)
	}
}

func jsonFields(typ reflect.Type) []string {
	fields := make([]string, 0, typ.NumField())
	for i := 0; i < typ.NumField(); i++ {
		tag := typ.Field(i).Tag.Get("json")
		name, _, _ := strings.Cut(tag, ",")
		if name == "" || name == "-" {
			continue
		}
		fields = append(fields, name)
	}
	return fields
}
