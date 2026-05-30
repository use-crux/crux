import { HomeLayout } from 'fumadocs-ui/layouts/home'
import { baseOptions } from '@/lib/layout.shared'
import type { ReactNode } from 'react'

export default function Layout({ children }: { children: ReactNode }) {
  const options = baseOptions()
  return (
    <HomeLayout
      {...options}
      links={[
        ...options.links!,
        {
          text: 'Examples',
          url: '/docs/cookbook',
        },
      ]}
      nav={{ ...options.nav, transparentMode: 'top' }}
    >
      {children}
    </HomeLayout>
  )
}
