import { handleOAuthStart } from '@/Slack/routes'

export async function GET(request: Request) {
  return handleOAuthStart(request)
}
