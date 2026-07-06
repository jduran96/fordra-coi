import { handleEvents } from '@/Slack/routes'

export const maxDuration = 60

export async function POST(request: Request) {
  return handleEvents(request)
}
