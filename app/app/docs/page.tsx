import { C } from '@/lib/theme'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth-helpers'
import ApiKeyManager from '@/components/ApiKeyManager'

export const dynamic = 'force-dynamic'

const BASE = (process.env.NEXT_PUBLIC_BASE_URL || 'https://fordra.com').replace(/\/$/, '')

export default async function DocsPage() {
  // Self-serve API keys (RLS scopes the query to the caller's org).
  const profile = await getProfile()
  let keys: never[] | Awaited<ReturnType<typeof loadKeys>> = []
  if (profile?.org_id) keys = await loadKeys()

  // The full verification object Fordra returns once a result is published. Reused
  // in both the GET example and the webhook envelope so the two never drift.
  const completed = `{
  "object": "verification",
  "id": "8f3c1a90-2b4d-4f1e-9c77-1a2b3c4d5e6f",
  "display_id": "VER-1043",
  "status": "completed",
  "carrier_name": "ACME Trucking LLC",
  "source": "api",
  "documents": [
    { "kind": "coi", "file_name": "coi.pdf" },
    { "kind": "requirements", "file_name": "standards.pdf" },
    { "kind": "rcs", "file_name": "ratecon.pdf" }
  ],
  "requirements": [
    { "type": "text", "value": "Auto Liability $1,000,000, Cargo $100,000, Fordra listed as certificate holder" }
  ],
  "requirements_normalized": [
    { "key": "auto_liability", "min_each_occurrence": "$1,000,000", "stated": true },
    { "key": "cargo", "min_limit": "$100,000", "stated": true },
    { "key": "certificate_holder", "value": "Fordra Financial", "stated": true }
  ],
  "coi_extracted": {
    "named_insured": "ACME Trucking LLC",
    "producer": "Smith Insurance Agency",
    "insurance_company": "Sample Mutual Insurance",
    "insurance_company_phone": "(555) 010-2000",
    "insurance_company_email": "certs@samplemutual.com",
    "certificate_holder": "Fordra",
    "additional_insured": "None listed",
    "coverages": [
      {
        "type": "Automobile Liability",
        "insurer": "Sample Mutual Insurance",
        "policy_number": "CA-4471829",
        "effective_date": "2026-01-01",
        "expiration_date": "2026-12-31",
        "each_occurrence_limit": "$1,000,000",
        "aggregate_limit": "$1,000,000"
      },
      {
        "type": "Cargo",
        "insurer": "Sample Mutual Insurance",
        "policy_number": "MC-9981245",
        "effective_date": "2026-01-01",
        "expiration_date": "2026-12-31",
        "each_occurrence_limit": "$80,000",
        "aggregate_limit": "$80,000"
      }
    ]
  },
  "gap_analysis": {
    "met": [
      {
        "requirement": { "coverage_type": "Automobile Liability", "minimum_limit": "$1,000,000" },
        "status": "met",
        "evidence": "Policy CA-4471829 carries a $1,000,000 each-occurrence limit, effective through 2026-12-31."
      }
    ],
    "not_met": [
      {
        "requirement": { "coverage_type": "Cargo", "minimum_limit": "$100,000" },
        "status": "not_met",
        "evidence": "Cargo policy MC-9981245 shows an $80,000 limit, below the required $100,000."
      }
    ],
    "uncertain": [
      {
        "requirement": { "coverage_type": "Certificate holder", "minimum_limit": "Fordra Financial listed" },
        "status": "uncertain",
        "evidence": "The certificate holder reads 'Fordra' without the full legal name. Confirm with the agent."
      }
    ]
  },
  "summary": "ACME Trucking LLC is mostly covered: Automobile Liability meets the $1,000,000 requirement. Cargo is short at $80,000 against the $100,000 minimum, and the certificate-holder name needs confirmation. We called the agent and the cargo shortfall is still open.",
  "error_detail": null,
  "created_at": "2026-06-25T14:00:00Z",
  "published_at": "2026-06-25T15:12:00Z"
}`

  // Indent every line after the first by `n` spaces, so the object nests cleanly.
  const indent = (s: string, n: number) =>
    s.split('\n').map((l, i) => (i === 0 ? l : ' '.repeat(n) + l)).join('\n')

  const webhook = `{
  "object": "event",
  "id": "evt_9a8b7c6d5e4f",
  "type": "verification.updated",
  "created_at": "2026-06-25T15:12:00Z",
  "data": {
    "object": ${indent(completed, 4)}
  }
}`

  const createResponse = `{
  "object": "verification",
  "id": "8f3c1a90-2b4d-4f1e-9c77-1a2b3c4d5e6f",
  "display_id": "VER-1043",
  "status": "processing",
  "carrier_name": "ACME Trucking LLC",
  "source": "api",
  "documents": [
    { "kind": "coi", "file_name": "coi.pdf" },
    { "kind": "requirements", "file_name": "standards.pdf" },
    { "kind": "rcs", "file_name": "ratecon.pdf" }
  ],
  "requirements": [
    { "type": "text", "value": "Auto Liability $1,000,000, Cargo $100,000" }
  ],
  "requirements_normalized": null,
  "coi_extracted": null,
  "gap_analysis": null,
  "summary": null,
  "error_detail": null,
  "created_at": "2026-06-25T14:00:00Z",
  "published_at": null
}`

  return (
    <div style={{ display: 'flex', gap: 48, alignItems: 'flex-start', fontFamily: C.sans }}>
      <div style={{ flex: 1, minWidth: 0, color: C.txt, lineHeight: 1.6 }}>
      <h1 style={{ fontFamily: C.serif, fontSize: 30, margin: '0 0 8px', fontWeight: 400 }}>API Docs</h1>
      <p style={{ color: C.txt2, fontSize: 15, margin: '0 0 28px' }}>
        Call the Fordra API to start a verification, listen to our webhook for the status, and re-call
        the Fordra API to view the verification&apos;s results. You can also view results via webapp
        on the Verifications tab.
      </p>

      {/* API key (admin-provisioned for the pilot) */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', margin: '0 0 30px' }}>
        <div style={{
          padding: '9px 16px', borderBottom: `1px solid ${C.border}`, background: C.paper,
          fontSize: 11.5, fontWeight: 600, color: C.txt3, fontFamily: C.sans,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>API key</div>
        {profile?.org_id ? (
          <ApiKeyManager keys={keys} />
        ) : (
          <p style={{ color: C.txt, fontSize: 14.5, margin: 0, padding: '14px 16px' }}>
            Please contact your Fordra admin at (727) 729-9594 to set up your API Key.
          </p>
        )}
      </div>

      <H id="authentication">Authentication</H>
      <P>Send your API key as a bearer token on every request. Anyone with this key can submit
        verifications under your organization, so keep it private. Requests without a valid key
        return a <Mono>401 Unauthorized</Mono> response.</P>
      <CodeBox title="Sample authenticated request">{`curl ${BASE}/v1/verifications \\
  -H "Authorization: Bearer `}<Key>sk_live_YOUR_KEY</Key>{`"`}</CodeBox>
      <Caption>The highlighted value is your whole API key. Replace <Mono>sk_live_</Mono> with
        {' '}<Mono>sk_test_</Mono> when you want to try the sandbox.</Caption>

      <H id="start-a-verification">Start a Verification</H>
      <Endpoint method="POST" path="/v1/verifications" />
      <P>Start a verification with one request. Include:</P>
      <Ul items={[
        <><Mono>carrier_name</Mono>: the carrier&apos;s legal name (text, required)</>,
        <><Mono>broker_name</Mono>: your company name (text, required)</>,
        <><Mono>coi</Mono>: the certificate of insurance (file, required)</>,
        <><Mono>insurance_standards</Mono>: your insurance requirements (text or file, required)</>,
        <><Mono>rate_confirmation</Mono>: the rate confirmation sheet (file, optional)</>,
      ]} />
      <P><B>Sending documents:</B> attach each file to the request as a normal file upload, the same
        way a web form uploads a file. There is no separate upload step and no link to host.</P>
      <CodeBox title="Sample POST request payload">{`curl -X POST ${BASE}/v1/verifications \\
  -H "Authorization: Bearer `}<Key>sk_live_YOUR_KEY</Key>{`" \\
  -F carrier_name="ACME Trucking LLC" \\
  -F broker_name="Fordra Financial" \\
  -F coi=@coi.pdf \\
  -F insurance_standards="Auto Liability $1,000,000, Cargo $100,000" \\
  -F rate_confirmation=@ratecon.pdf`}</CodeBox>
      <P>A successful POST returns <Mono>201</Mono> with the verification object. The
        {' '}<Mono>status</Mono> field will read <Mono>processing</Mono> because reviews are done
        asynchronously. The analysis fields stay <Mono>null</Mono> until the verification is
        complete. Remember to store the <Mono>id</Mono> field as you will use this to identify this
        verification later.</P>
      <CodeBox title="Sample POST response payload">{createResponse}</CodeBox>

      <H id="review-a-result">Review a Result</H>

      <SubH id="via-webhook">Via webhook</SubH>
      <P>Give your endpoint URL to your Fordra admin to register it. On each status change, Fordra
        sends a <Mono>POST</Mono> to that URL with a signed JSON envelope. Match
        {' '}<Mono>data.object.id</Mono> to the <Mono>id</Mono> you stored in the POST response
        payload from before.</P>
      <CodeBox title="Successful verification webhook payload">{webhook}</CodeBox>
      <P>The response is the full verification: the extracted COI fields
        (<Mono>coi_extracted</Mono>), your insurance standards (<Mono>requirements</Mono> and
        {' '}<Mono>requirements_normalized</Mono>), references to the documents you submitted
        (<Mono>documents</Mono>), the requirement-by-requirement <Mono>gap_analysis</Mono>
        {' '}(<Mono>met</Mono> / <Mono>not_met</Mono> / <Mono>uncertain</Mono> with evidence), and a
        plain-language <Mono>summary</Mono>.</P>

      <SubH id="via-get">Via GET</SubH>
      <Endpoint method="GET" path="/v1/verifications/:id" />
      <P>Call the endpoint with the <Mono>id</Mono> you stored from your start verification response
        payload.</P>
      <CodeBox title="Sample GET request payload">{`curl ${BASE}/v1/verifications/8f3c1a90-2b4d-4f1e-9c77-1a2b3c4d5e6f \\
  -H "Authorization: Bearer `}<Key>sk_live_YOUR_KEY</Key>{`"`}</CodeBox>
      <CodeBox title="Sample GET response payload">{completed}</CodeBox>

      <H id="sandbox">Sandbox</H>
      <P>The sandbox
        verification will resolve instantly and return a sample of extracted fields, gap analysis,
        and verification result. A sample webhook with a success status will also fire. In sandbox,
        nothing is sent to a human reviewer and no insurance agent is called.</P>

      <p style={{ color: C.txt3, fontSize: 13, marginTop: 36 }}>
        Need a field you don&apos;t see here? Contact your Fordra admin at (727) 729-9594.
      </p>
      </div>
      <Toc />
    </div>
  )
}

function Toc() {
  const items: [string, string, number][] = [
    ['authentication', 'Authentication', 0],
    ['start-a-verification', 'Start a Verification', 0],
    ['review-a-result', 'Review a Result', 0],
    ['via-webhook', 'Via webhook', 1],
    ['via-get', 'Via GET', 1],
    ['sandbox', 'Sandbox', 0],
  ]
  return (
    <nav className="docs-toc" style={{ position: 'sticky', top: 32, alignSelf: 'flex-start', width: 180, flexShrink: 0, fontFamily: C.sans }}>
      <style>{`
        @media (max-width: 880px) { .docs-toc { display: none !important; } }
        .docs-toc a { color: ${C.txt2}; text-decoration: none; display: block; transition: color 120ms; }
        .docs-toc a:hover { color: ${C.txt}; }
        .docs-toc a.sub { color: ${C.txt3}; }
      `}</style>
      <p style={{ fontSize: 11.5, fontWeight: 600, color: C.txt3, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 12px' }}>
        On this page
      </p>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 9, borderLeft: `1px solid ${C.border}` }}>
        {items.map(([id, label, depth]) => (
          <li key={id} style={{ paddingLeft: depth ? 24 : 12 }}>
            <a href={`#${id}`} className={depth ? 'sub' : undefined} style={{ fontSize: 13 }}>{label}</a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function H({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h2 id={id} style={{ fontSize: 17, fontWeight: 600, color: C.txt, margin: '30px 0 8px', scrollMarginTop: 24 }}>{children}</h2>
}
function SubH({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h3 id={id} style={{ fontSize: 14, fontWeight: 600, color: C.txt, margin: '18px 0 6px', scrollMarginTop: 24 }}>{children}</h3>
}
function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <p style={{ margin: '0 0 10px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{
        fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, color: C.txt,
        background: 'rgba(212, 253, 142, 0.6)', padding: '2px 8px', borderRadius: 5, letterSpacing: '0.04em',
      }}>{method}</span>
      <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13.5, color: C.txt }}>{path}</code>
    </p>
  )
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ color: C.txt2, fontSize: 14.5, margin: '0 0 10px' }}>{children}</p>
}
function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: C.txt }}>{children}</strong>
}
function Mono({ children }: { children: React.ReactNode }) {
  return <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13, background: C.paper, padding: '1px 5px', borderRadius: 4, border: `1px solid ${C.border}` }}>{children}</code>
}
function Key({ children }: { children: React.ReactNode }) {
  return <span style={{ background: 'rgba(212, 253, 142, 0.6)', color: C.txt, fontWeight: 700, padding: '0 4px', borderRadius: 3 }}>{children}</span>
}
function Caption({ children }: { children: React.ReactNode }) {
  return <p style={{ color: C.txt3, fontSize: 12.5, margin: '-6px 0 14px' }}>{children}</p>
}
function Ul({ items }: { items: React.ReactNode[] }) {
  return <ul style={{ color: C.txt2, fontSize: 14.5, margin: '0 0 10px', paddingLeft: 20 }}>
    {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
  </ul>
}
/** Titled code block: header sits inside the bordered box, matching the API-key card. */
function CodeBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', minWidth: 0, margin: '0 0 14px' }}>
      <div style={{
        padding: '9px 16px', borderBottom: `1px solid ${C.border}`, background: C.paper,
        fontSize: 11.5, fontWeight: 600, color: C.txt3, fontFamily: C.sans,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{title}</div>
      <pre style={{
        fontFamily: 'ui-monospace, monospace', fontSize: 13, color: C.txt, background: C.surface,
        padding: '14px 16px', overflowX: 'auto', margin: 0, lineHeight: 1.5, whiteSpace: 'pre',
      }}>{children}</pre>
    </div>
  )
}

async function loadKeys() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('api_keys')
    .select('id, mode, key_prefix, name, created_at, last_used_at, revoked_at')
    .order('created_at', { ascending: false })
  return data ?? []
}
