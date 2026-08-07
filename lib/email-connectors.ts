import 'server-only'
import type { TokenResponse } from '@/lib/email-oauth'
import type { EmailProvider } from '@/lib/email-provider'
import { exchangeCode, fetchGmailProfile, gmailAuthUrl, gmailProvider } from '@/lib/gmail'
import { exchangeMicrosoftCode, fetchMicrosoftProfile, microsoftAuthUrl, microsoftProvider } from '@/lib/microsoft-graph'

/**
 * Registry of connectable mailbox vendors: the dynamic
 * /api/admin/email-oauth/[provider] routes, providerFor, and the attachment
 * guard all read this, so adding a vendor means one provider module plus an
 * entry here (mirror it in EMAIL_CONNECT_OPTIONS, lib/email-shared.ts, for the
 * settings card). `segment` is the OAuth route path piece and `provider` the
 * email_accounts.provider value; they differ for Gmail because the /google/
 * callback URI is registered with Google and must not change.
 */
export interface EmailConnector {
  segment: string
  provider: string
  /** Product name for buttons and account rows ('Gmail'). */
  label: string
  /** Vendor name for OAuth error copy ('Google'). */
  vendor: string
  impl: EmailProvider
  /** Cap on one send's combined attachment bytes. Both vendors could take
   *  more (Gmail ~25 MB raw, Graph 150 MB via upload sessions), but
   *  attachments are buffered in serverless memory, so 15 MB is the real
   *  ceiling either way. */
  maxAttachmentBytes: number
  authUrl(state: string): string
  exchangeCode(code: string): Promise<TokenResponse>
  fetchProfile(accessToken: string): Promise<{ emailAddress: string; displayName: string | null }>
  /** Callback failure copy when the vendor returns no refresh token. */
  missingRefreshTokenHelp: string
}

export const EMAIL_CONNECTORS: EmailConnector[] = [
  {
    segment: 'google',
    provider: 'gmail',
    label: 'Gmail',
    vendor: 'Google',
    impl: gmailProvider,
    maxAttachmentBytes: 15 * 1024 * 1024,
    authUrl: gmailAuthUrl,
    exchangeCode,
    fetchProfile: async accessToken => ({ ...(await fetchGmailProfile(accessToken)), displayName: null }),
    missingRefreshTokenHelp: "Google returned no refresh token. Remove Fordra from the Google account's third-party access list and connect again.",
  },
  {
    segment: 'microsoft',
    provider: 'microsoft',
    label: 'Outlook',
    vendor: 'Microsoft',
    impl: microsoftProvider,
    maxAttachmentBytes: 15 * 1024 * 1024,
    authUrl: microsoftAuthUrl,
    exchangeCode: exchangeMicrosoftCode,
    fetchProfile: fetchMicrosoftProfile,
    missingRefreshTokenHelp: 'Microsoft returned no refresh token. Try Connect again.',
  },
]

export const connectorBySegment = (segment: string): EmailConnector | undefined =>
  EMAIL_CONNECTORS.find(c => c.segment === segment)

export const connectorByProvider = (provider: string): EmailConnector | undefined =>
  EMAIL_CONNECTORS.find(c => c.provider === provider)
