import { handleEvents } from '@/Slack/routes'

// 300 covers the after()-deferred auto OCR + contact check on Slack-created
// verifications (repeat-bug #6); the inline Slack ack latency is unchanged —
// events are still processed and answered before the deferred work starts.
export const maxDuration = 300

export async function POST(request: Request) {
  return handleEvents(request)
}
