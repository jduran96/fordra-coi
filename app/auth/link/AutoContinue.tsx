'use client'

import { useEffect } from 'react'

/**
 * Real browsers run this and continue to the callback immediately, so humans
 * never dwell here. Link-preview crawlers and mail scanners fetch the HTML
 * but do not execute JS or submit forms, so the single-use token survives
 * them. The visible button is the no-JS fallback.
 */
export default function AutoContinue({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href)
  }, [href])
  return null
}
