import { handleOAuthCallback } from '@/Slack/routes'

export async function GET(request: Request) {
  return handleOAuthCallback(request)
}
