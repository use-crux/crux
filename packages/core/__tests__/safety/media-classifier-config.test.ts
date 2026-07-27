import { describe, expect, it } from 'vitest'
import { guardrail } from '../../src/safety'
import {
  generate,
  normalize,
  validOptions,
} from './media-classifier-config.fixtures'

describe('normalizeMediaClassifierConfig', () => {
  it('exposes the completed public strategy', () => {
    expect(guardrail.mediaClassifier).toBeTypeOf('function')
  })

  it.each([
    {
      name: 'missing',
      value: {
        generate,
        model: 'classifier-model',
        threshold: 0.8,
      },
    },
    { name: 'empty', value: { ...validOptions(), categories: [] } },
  ])('rejects $name categories', ({ value }) => {
    expect(() => normalize(value)).toThrowError(
      /categories must contain at least one category/,
    )
  })

  it.each([
    { id: '', boundary: 'empty' },
    { id: '1starts-with-number', boundary: 'start character' },
    { id: 'Uppercase', boundary: 'uppercase' },
    { id: 'contains/slash', boundary: 'punctuation' },
    { id: `a${'b'.repeat(64)}`, boundary: '65 characters' },
  ])('rejects category ID outside the grammar: $boundary', ({ id }) => {
    expect(() =>
      normalize({
        ...validOptions(),
        categories: [{ id, description: 'Criterion.' }],
      }),
    ).toThrowError(/category IDs must match/)
  })

  it.each(['a', 'a.b_c-d9', `a${'b'.repeat(63)}`])(
    'accepts category ID grammar boundary %s',
    (id) => {
      expect(() =>
        normalize({
          ...validOptions(),
          categories: [{ id, description: 'Criterion.' }],
        }),
      ).not.toThrow()
    },
  )

  it('rejects duplicate category IDs', () => {
    expect(() =>
      normalize({
        ...validOptions(),
        categories: [
          { id: 'duplicate', description: 'First criterion.' },
          { id: 'duplicate', description: 'Second criterion.' },
        ],
      }),
    ).toThrowError(/category IDs must be unique/)
  })

  it.each(['', '   '])(
    'rejects empty category description %j',
    (description) => {
      expect(() =>
        normalize({
          ...validOptions(),
          categories: [{ id: 'category', description }],
        }),
      ).toThrowError(/descriptions must contain non-whitespace text/)
    },
  )

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    'rejects invalid global threshold %j',
    (threshold) => {
      expect(() =>
        normalize({ ...validOptions(), threshold }),
      ).toThrowError(/threshold must be a finite number between 0 and 1/)
    },
  )

  it.each([0, 1])('accepts global threshold boundary %d', (threshold) => {
    expect(normalize({ ...validOptions(), threshold }).threshold).toBe(
      threshold,
    )
  })

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, -0.01, 1.01])(
    'rejects invalid threshold override %j',
    (threshold) => {
      expect(() =>
        normalize({
          ...validOptions(),
          thresholds: { 'sexual-content': threshold },
        }),
      ).toThrowError(
        /thresholds\.sexual-content must be a finite number between 0 and 1/,
      )
    },
  )

  it('rejects threshold overrides for unknown category IDs', () => {
    expect(() =>
      normalize({
        ...validOptions(),
        thresholds: { 'not-authored': 0.9 },
      }),
    ).toThrowError(/threshold override "not-authored" has no authored category/)
  })

  it.each([
    { modalities: [], message: /modalities must contain at least one modality/ },
    {
      modalities: ['image', 'image'],
      message: /modalities must be unique/,
    },
    {
      modalities: ['text'],
      message: /modalities must contain only image, audio, video, or file/,
    },
  ])('rejects invalid modalities $modalities', ({ modalities, message }) => {
    expect(() =>
      normalize({ ...validOptions(), modalities }),
    ).toThrowError(message)
  })

  it.each(['allow', 'throw', 'unknown'])(
    'rejects matched action %j',
    (action) => {
      expect(() =>
        normalize({ ...validOptions(), action }),
      ).toThrowError(/action must be "warn", "block", or "strip"/)
    },
  )

  it.each(['throw', 'unknown'])(
    'rejects unsupported action %j',
    (unsupported) => {
      expect(() =>
        normalize({ ...validOptions(), unsupported }),
      ).toThrowError(
        /unsupported must be "allow", "warn", "block", or "strip"/,
      )
    },
  )

  it.each([
    ...['warn', 'block', 'strip'].map((value) => ({
      field: 'action' as const,
      value,
    })),
    ...['allow', 'warn', 'block', 'strip'].map((value) => ({
      field: 'unsupported' as const,
      value,
    })),
  ])('accepts $field vocabulary value $value', ({ field, value }) => {
    expect(normalize({ ...validOptions(), [field]: value })[field]).toBe(value)
  })

  it('normalizes all defaults and privacy-safe strategy data', () => {
    expect(normalize(validOptions())).toEqual({
      generate,
      model: 'classifier-model',
      categories: [
        { id: 'sexual-content', description: 'Sexual or explicit content.' },
        { id: 'graphic-violence', description: 'Graphic physical injury.' },
      ],
      threshold: 0.8,
      thresholds: {},
      action: 'block',
      modalities: ['image', 'audio', 'video', 'file'],
      unsupported: 'throw',
      strategyConfig: {
        categoryIds: ['sexual-content', 'graphic-violence'],
        threshold: 0.8,
        thresholds: {},
        action: 'block',
        modalities: ['image', 'audio', 'video', 'file'],
        unsupported: 'throw',
      },
    })
  })

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects hostile category ID %j',
    (id) => {
      expect(() =>
        normalize({
          ...validOptions(),
          categories: [{ id, description: 'Hostile criterion.' }],
        }),
      ).toThrowError(/unsafe object key/)
    },
  )

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects hostile threshold key %j',
    (id) => {
      expect(() =>
        normalize({
          ...validOptions(),
          thresholds: Object.fromEntries([[id, 0.9]]),
        }),
      ).toThrowError(/unsafe object key/)
    },
  )

  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects hostile option key %j',
    (id) => {
      expect(() =>
        normalize({
          ...validOptions(),
          ...Object.fromEntries([[id, true]]),
        }),
      ).toThrowError(/unsafe object key/)
    },
  )

  it('detaches inputs and deeply freezes normalized runtime and strategy config', () => {
    const category = {
      id: 'category',
      description: '  Authored criterion.  ',
    }
    const categories = [category]
    const thresholds = { category: 0.9 }
    const modalities = ['image', 'file']
    const config = normalize({
      ...validOptions(),
      categories,
      thresholds,
      modalities,
      action: 'warn',
      unsupported: 'strip',
    })

    category.description = 'mutated'
    categories.push({ id: 'later', description: 'Later criterion.' })
    thresholds.category = 0.1
    modalities[0] = 'video'

    expect({
      categories: config.categories,
      thresholds: config.thresholds,
      modalities: config.modalities,
      strategyConfig: config.strategyConfig,
      nullPrototypeThresholds:
        Object.getPrototypeOf(config.thresholds) === null,
      frozen: [
        config,
        config.categories,
        config.categories[0],
        config.thresholds,
        config.modalities,
        config.strategyConfig,
        config.strategyConfig.categoryIds,
        config.strategyConfig.thresholds,
        config.strategyConfig.modalities,
      ].every(Object.isFrozen),
    }).toEqual({
      categories: [
        { id: 'category', description: 'Authored criterion.' },
      ],
      thresholds: { category: 0.9 },
      modalities: ['image', 'file'],
      strategyConfig: {
        categoryIds: ['category'],
        threshold: 0.8,
        thresholds: { category: 0.9 },
        action: 'warn',
        modalities: ['image', 'file'],
        unsupported: 'strip',
      },
      nullPrototypeThresholds: true,
      frozen: true,
    })
  })
})
