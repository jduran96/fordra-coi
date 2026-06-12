'use client';

import { C } from '@/components/ui/tokens';
import { Card, FieldLabel, PageTitle, Pill } from '@/components/ui/primitives';
import { CodeBlock } from '@/components/ui/CodeBlock';

const SECTIONS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'auth',      label: 'Authentication' },
  { id: 'create',    label: 'Create a verification' },
  { id: 'retrieve',  label: 'Retrieve a verification' },
  { id: 'list',      label: 'List verifications' },
  { id: 'webhooks',  label: 'Webhooks' },
];

function MethodPath({ method, path }: { method: 'POST' | 'GET'; path: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
      <Pill label={method} color={method === 'POST' ? C.accent : C.success} />
      <code style={{
        fontSize: 13.5, fontFamily: "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, monospace",
        color: C.txt, background: C.surfaceHover,
        padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
      }}>
        {path}
      </code>
    </div>
  );
}

function ParamsTable({ rows }: { rows: { name: string; type: string; required: boolean; desc: string }[] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' as const, marginBottom: 16 }}>
      <thead>
        <tr>
          {['Parameter', 'Type', 'Description'].map(h => (
            <th key={h} style={{
              padding: '8px 10px', textAlign: 'left' as const,
              fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase' as const, color: C.txt3, fontFamily: C.sans,
              borderBottom: `1px solid ${C.border}`,
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name}>
            <td style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' }}>
              <code style={{ fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace", color: C.txt, fontWeight: 600 }}>
                {r.name}
              </code>
              {r.required && (
                <span style={{ fontSize: 10, fontWeight: 700, color: C.error, fontFamily: C.sans, marginLeft: 6 }}>
                  required
                </span>
              )}
            </td>
            <td style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, fontSize: 12.5, color: C.txt3, fontFamily: "ui-monospace, Menlo, monospace", verticalAlign: 'top' }}>
              {r.type}
            </td>
            <td style={{ padding: '10px', borderBottom: `1px solid ${C.border}`, fontSize: 13, color: C.txt2, fontFamily: C.sans, lineHeight: 1.55, verticalAlign: 'top' }}>
              {r.desc}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} style={{
      fontFamily: C.serif, fontSize: 24, fontWeight: 400,
      letterSpacing: '-0.02em', color: C.txt,
      margin: '48px 0 14px', scrollMarginTop: 24,
    }}>
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 14, color: C.txt2, fontFamily: C.sans, lineHeight: 1.7, margin: '0 0 16px' }}>
      {children}
    </p>
  );
}

export default function AppDocsPage() {
  return (
    <div style={{ maxWidth: 920, display: 'flex', gap: 48, alignItems: 'flex-start' }}>
      {/* ── Body ── */}
      <div style={{ flex: 1, minWidth: 0, maxWidth: 720 }}>
        <PageTitle subtitle="Fire verification requests programmatically instead of using the Upload page.">
          API Reference
        </PageTitle>

        <SectionHeading id="overview">Overview</SectionHeading>
        <P>
          The Fordra API lets you submit certificates of insurance for verification and
          retrieve results as they complete. All requests are made over HTTPS to the base URL
          below and return JSON.
        </P>
        <Card style={{ padding: '18px 24px' }}>
          <FieldLabel style={{ marginBottom: 6 }}>Base URL</FieldLabel>
          <code style={{ fontSize: 14, fontFamily: "ui-monospace, Menlo, monospace", color: C.txt }}>
            https://api.fordra.com/v1
          </code>
        </Card>

        <SectionHeading id="auth">Authentication</SectionHeading>
        <P>
          Authenticate every request with your API key in the <code>Authorization</code> header.
          Keys are issued per environment — test keys are prefixed <code>frd_test_</code>, live keys
          <code> frd_live_</code>. Contact us to rotate or revoke a key.
        </P>
        <CodeBlock
          label="Header"
          code={`Authorization: Bearer frd_live_4eC39HqLyjWDarjtT1zdp7dc`}
        />

        <SectionHeading id="create">Create a verification</SectionHeading>
        <MethodPath method="POST" path="/verifications" />
        <P>
          Submit a carrier&apos;s documents for verification. The request is <code>multipart/form-data</code> with
          three files and the carrier&apos;s legal name. Returns immediately with a verification ID; results
          are delivered via webhook or polling.
        </P>
        <ParamsTable rows={[
          { name: 'carrier_name',      type: 'string', required: true,  desc: "The carrier's legal entity name as it should appear on the COI." },
          { name: 'requirements',      type: 'file',   required: true,  desc: 'Your coverage requirements (PDF, DOCX, image, or TXT). Alternatively pass requirements_json.' },
          { name: 'coi',               type: 'file',   required: true,  desc: "The carrier's certificate of insurance (ACORD 25) as PDF or image." },
          { name: 'rate_confirmation', type: 'file',   required: true,  desc: 'The signed rate confirmation sheet as PDF or image.' },
          { name: 'requirements_json', type: 'array',  required: false, desc: 'Structured requirements [{coverage_type, minimum_limit, notes}] in place of a requirements file.' },
        ]} />
        <CodeBlock
          label="curl"
          code={`curl https://api.fordra.com/v1/verifications \\
  -H "Authorization: Bearer frd_live_..." \\
  -F carrier_name="Sunrise Trucking LLC" \\
  -F requirements=@requirements.pdf \\
  -F coi=@sunrise-acord25.pdf \\
  -F rate_confirmation=@rate-conf.pdf`}
        />
        <CodeBlock
          label="Node.js"
          code={`const form = new FormData();
form.append("carrier_name", "Sunrise Trucking LLC");
form.append("requirements", new Blob([reqBuf]), "requirements.pdf");
form.append("coi", new Blob([coiBuf]), "acord25.pdf");
form.append("rate_confirmation", new Blob([rcsBuf]), "rate-conf.pdf");

const res = await fetch("https://api.fordra.com/v1/verifications", {
  method: "POST",
  headers: { Authorization: \`Bearer \${process.env.FORDRA_API_KEY}\` },
  body: form,
});
const verification = await res.json();
// => { "id": "vrf_1068", "status": "pending", "created_at": "..." }`}
        />

        <SectionHeading id="retrieve">Retrieve a verification</SectionHeading>
        <MethodPath method="GET" path="/verifications/:id" />
        <P>
          Fetch a single verification, including the gap analysis and final report once available.
        </P>
        <CodeBlock
          label="curl"
          code={`curl https://api.fordra.com/v1/verifications/vrf_1068 \\
  -H "Authorization: Bearer frd_live_..."`}
        />
        <CodeBlock
          label="Response"
          code={`{
  "id": "vrf_1068",
  "status": "completed",
  "carrier_name": "Sunrise Trucking LLC",
  "created_at": "2026-06-12T07:48:00Z",
  "gap_analysis": { "met": [...], "not_met": [], "uncertain": [] },
  "final_report": {
    "narrative_summary": "Sunrise Trucking LLC meets all coverage requirements...",
    "report_pdf_url": "https://api.fordra.com/v1/verifications/vrf_1068/report.pdf"
  }
}`}
        />

        <SectionHeading id="list">List verifications</SectionHeading>
        <MethodPath method="GET" path="/verifications" />
        <P>Returns your verifications, most recent first.</P>
        <ParamsTable rows={[
          { name: 'status',  type: 'string',  required: false, desc: 'Filter by status: pending, completed, or error.' },
          { name: 'limit',   type: 'integer', required: false, desc: 'Page size, 1–100. Defaults to 20.' },
          { name: 'cursor',  type: 'string',  required: false, desc: 'Opaque pagination cursor from a previous response.' },
        ]} />
        <CodeBlock
          label="curl"
          code={`curl "https://api.fordra.com/v1/verifications?status=completed&limit=20" \\
  -H "Authorization: Bearer frd_live_..."`}
        />

        <SectionHeading id="webhooks">Webhooks</SectionHeading>
        <P>
          Register a webhook endpoint with us and Fordra will POST an event when a verification
          finishes, so you don&apos;t need to poll. Verify the <code>Fordra-Signature</code> header
          (HMAC-SHA256 of the raw body with your webhook secret) before trusting a payload.
        </P>
        <ParamsTable rows={[
          { name: 'verification.completed', type: 'event', required: false, desc: 'Final report is ready. Payload includes the full verification object.' },
          { name: 'verification.failed',    type: 'event', required: false, desc: 'The verification hit an unrecoverable error. Payload includes error_detail.' },
        ]} />
        <CodeBlock
          label="Sample payload"
          code={`{
  "event": "verification.completed",
  "created_at": "2026-06-12T15:02:11Z",
  "data": {
    "id": "vrf_1068",
    "status": "completed",
    "carrier_name": "Sunrise Trucking LLC",
    "final_report": { ... }
  }
}`}
        />

        <Card style={{ marginTop: 40, padding: '18px 24px' }}>
          <p style={{ fontSize: 13, color: C.txt2, fontFamily: C.sans, lineHeight: 1.6, margin: 0 }}>
            <strong style={{ color: C.txt }}>Pilot note:</strong> the API is in private preview for design
            partners. Endpoints and payloads may evolve — we&apos;ll give you notice before any breaking change.
          </p>
        </Card>
      </div>

      {/* ── Sticky section index ── */}
      <nav style={{
        position: 'sticky', top: 48,
        width: 168, flexShrink: 0,
        display: 'flex', flexDirection: 'column' as const, gap: 2,
        paddingTop: 8,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
          textTransform: 'uppercase' as const, color: C.txt3,
          fontFamily: C.sans, marginBottom: 8,
        }}>
          On this page
        </span>
        {SECTIONS.map(s => (
          <a
            key={s.id}
            href={`#${s.id}`}
            style={{
              fontSize: 12.5, fontFamily: C.sans, color: C.txt3,
              textDecoration: 'none', padding: '4px 0',
            }}
          >
            {s.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
