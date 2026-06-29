'use client'

import Link from 'next/link'
import posthog from 'posthog-js'
import type { ComponentProps } from 'react'

type TrackedLinkProps = ComponentProps<typeof Link> & {
  event: string
  properties?: Record<string, unknown>
}

export function TrackedLink({ event, properties, onClick, ...props }: TrackedLinkProps) {
  return (
    <Link
      {...props}
      onClick={(e) => {
        posthog.capture(event, { href: String(props.href), ...properties })
        onClick?.(e)
      }}
    />
  )
}
