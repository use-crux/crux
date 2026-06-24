package record

import (
	"github.com/use-crux/crux/packages/local/internal/indexhost/native/syntax"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func CallInterests(input []projectindex.StaticCallInterest) []syntax.CallInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.CallInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.CallInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  callbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func ConstructorInterests(input []projectindex.StaticConstructorInterest) []syntax.ConstructorInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.ConstructorInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.ConstructorInterest{
			Name:       interest.Name,
			ImportFrom: append([]string(nil), interest.ImportFrom...),
			ConfigArg:  interest.ConfigArg,
			Properties: append([]string(nil), interest.Properties...),
			Callbacks:  callbackInterests(interest.Callbacks),
			Source:     interest.Source,
		})
	}
	return interests
}

func callbackInterests(input []projectindex.StaticCallbackInterest) []syntax.CallbackInterest {
	if len(input) == 0 {
		return nil
	}
	interests := make([]syntax.CallbackInterest, 0, len(input))
	for _, interest := range input {
		interests = append(interests, syntax.CallbackInterest{
			Property: interest.Property,
			MaxDepth: interest.MaxDepth,
		})
	}
	return interests
}
