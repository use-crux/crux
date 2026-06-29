import { source } from '@/lib/source'
import { createFromSource } from 'fumadocs-core/search/server'
import { after } from 'next/server'
import { getPostHogClient } from '@/lib/posthog-server'

const { GET: fumadocsGET } = createFromSource(source, {
  language: 'english',
})

// In cookieless mode PostHog does not set the `ph_<token>_posthog` cookie, so this
// usually returns null. Kept as a best-effort hook if persistence is re-enabled.
function getDistinctId(request: Request): string | null {
  const cookie = request.headers.get('cookie')
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
  if (!cookie || !token) return null

  const name = `ph_${token}_posthog`
  const entry = cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  if (!entry) return null

  try {
    const parsed = JSON.parse(decodeURIComponent(entry.slice(name.length + 1))) as {
      distinct_id?: string
    }
    return parsed.distinct_id ?? null
  } catch {
    return null
  }
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('query')?.trim()

  if (query) {
    const distinctId = getDistinctId(request)
    const posthog = getPostHogClient()
    posthog.capture({
      distinctId: distinctId ?? 'anonymous-docs-search',
      event: 'docs_searched',
      properties: {
        query,
        // Cookieless mode: no client cookie, so suppress person profiles.
        $process_person_profile: false,
      },
    })
    // Flush after the response is sent so search-as-you-type latency is not
    // tied to a round-trip to PostHog (the docs search hits this per keystroke).
    after(async () => {
      await posthog.flush()
    })
  }

  return fumadocsGET(request)
}
