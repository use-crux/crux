import type { QualityConfig } from '../src/quality'

const launchQualityConfig = {
  include: ['evals/**/*.eval.ts', '**/*.eval.ts'],
  dir: '.crux/quality',
  redact: ['customer.email'],
  defaults: { replay: 'replay-strict' },
} satisfies QualityConfig

const qualityProfilesAreNotLaunchApi = {
  // @ts-expect-error Quality profiles are not part of the pre-launch config surface.
  profiles: {
    ci: { replay: 'replay-strict' },
  },
} satisfies QualityConfig

const qualitySetupIsNotLaunchApi = {
  // @ts-expect-error Model/provider setup belongs in eval-local helpers, not project config.
  setup: async () => ({ generate: async () => ({ text: 'hidden provider fallback' }) }),
} satisfies QualityConfig

void launchQualityConfig
void qualityProfilesAreNotLaunchApi
void qualitySetupIsNotLaunchApi
