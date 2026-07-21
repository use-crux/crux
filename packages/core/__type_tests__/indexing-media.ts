import type { CruxDocument } from '../src/indexing'

const mediaOnly = {
  namespace: 'products',
  sourceId: 'rex',
  asset: {
    type: 'data',
    data: new Uint8Array([1, 2, 3]),
    mediaType: 'image/png',
  },
} satisfies CruxDocument

const mediaPart = {
  namespace: 'products',
  sourceId: 'clip',
  parts: [{
    id: 'clip:1',
    kind: 'media',
    modality: 'video',
    asset: {
      type: 'url',
      url: new URL('https://cdn.example/clip.mp4'),
      mediaType: 'video/mp4',
    },
  }],
} satisfies CruxDocument

void mediaOnly
void mediaPart

const invalidMediaPart = {
  namespace: 'products',
  sourceId: 'invalid',
  parts: [{
    id: 'invalid:1',
    kind: 'media',
    // @ts-expect-error media ingest parts cannot declare the text modality
    modality: 'text',
    asset: {
      type: 'data',
      data: new Uint8Array([1]),
      mediaType: 'image/png',
    },
  }],
} satisfies CruxDocument

void invalidMediaPart
