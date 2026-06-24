package projectindexer

import "github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"

type syntaxCompilerWorker struct {
	*syntax.Worker
}

func newSyntaxCompiler(commandPath string, commandArgs ...string) *syntaxCompilerWorker {
	return &syntaxCompilerWorker{Worker: syntax.New(commandPath, commandArgs...)}
}

type syntaxCompilerPool struct {
	*syntax.Pool
}

func newSyntaxCompilerPool(size int, commandPath string, commandArgs ...string) *syntaxCompilerPool {
	return &syntaxCompilerPool{Pool: syntax.NewPool(size, commandPath, commandArgs...)}
}

func newAdaptiveSyntaxCompilerPool(maxSize int, commandPath string, commandArgs ...string) *syntaxCompilerPool {
	return &syntaxCompilerPool{Pool: syntax.NewAdaptivePool(maxSize, commandPath, commandArgs...)}
}

func (p *syntaxCompilerPool) compilerWorker() (*syntaxCompilerWorker, error) {
	worker, err := p.CompilerWorker()
	if err != nil {
		return nil, err
	}
	return &syntaxCompilerWorker{Worker: worker}, nil
}
