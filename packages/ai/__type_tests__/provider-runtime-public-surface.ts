/**
 * Compile-time checks for the `@use-crux/ai` provider runtime export.
 */

import { expectTypeOf } from 'vitest'
import type { LanguageModel } from 'ai'
import type {
  CruxExecutor,
  ExecutorGenerateResult,
  ExecutorModelArg,
  ExecutorStreamHandle,
} from '@use-crux/core/adapter'
import type { Reranker, RetrievalModel } from '@use-crux/core/retrieval'
import { aiSdkProviderRuntime } from '../src'
import type { SdkLoopResultLike, SdkStreamResultLike } from '../src/executor'
import type { AiSdkRuntimeExtensions } from '../src/extensions'
import type { SdkGateway } from '../src/gateway'

type AiRuntime = ReturnType<typeof aiSdkProviderRuntime.create>
type AiGenerateOptions = Parameters<AiRuntime['generate']>[1]

expectTypeOf<Parameters<typeof aiSdkProviderRuntime.create>[0]>().toEqualTypeOf<SdkGateway>()
expectTypeOf<AiRuntime>().toMatchTypeOf<
  CruxExecutor<LanguageModel, SdkLoopResultLike, SdkStreamResultLike> & AiSdkRuntimeExtensions
>()
expectTypeOf<Awaited<ReturnType<AiRuntime['generate']>>>().toEqualTypeOf<
  ExecutorGenerateResult<SdkLoopResultLike>
>()
expectTypeOf<Awaited<ReturnType<AiRuntime['stream']>>>().toEqualTypeOf<
  ExecutorStreamHandle<SdkStreamResultLike>
>()
expectTypeOf<AiGenerateOptions['model']>().toEqualTypeOf<ExecutorModelArg<LanguageModel>>()
// @ts-expect-error - media estimation remains private adapter integration.
type MissingMediaEstimator = AiGenerateOptions['mediaEstimator']
// @ts-expect-error - private media hooks do not appear on provider runtime records.
aiSdkProviderRuntime.media
// @ts-expect-error - capability setup is intentionally absent.
aiSdkProviderRuntime.capabilities()
expectTypeOf<ReturnType<AiRuntime['retrievalModel']>>().toEqualTypeOf<RetrievalModel>()
expectTypeOf<ReturnType<AiRuntime['reranker']>>().toEqualTypeOf<Reranker>()

void (undefined as unknown as MissingMediaEstimator)
