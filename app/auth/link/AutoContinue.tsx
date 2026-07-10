'use client'

import { useEffect } from 'react'

/**
 * Real browsers run this and continue to the callback immediately, so humans
 * never dwell here. Link-preview crawlers and mail scanners fetch the HTML
 * but do not execute JS, so the single-use token survives them. This is the
 * ONLY path from the interstitial to the callback: the page shows just a
 * spinner, no button, so nothing here is followable without running JS.
 */
export default function AutoContinue({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href)
  }, [href])
  return null
}
