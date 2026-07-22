import type { SupabaseClient } from '@supabase/supabase-js'
import type { Requirement } from '@/lib/types'
import { requirementKind, VARIABLE_TOKEN_RE } from '@/lib/types'

/**
 * Insurance-standards templates: org-saved requirement sets selectable at
 * submission time (web picker, /v1 template_id, Slack). Rows may contain
 * {token} placeholders resolved per deal from `variables` — e.g. Dakota's
 * physical-damage limit is "{asset_sale_price}".
 */

/**
 * Condition rows every logistics broker/factor tends to want on a COI. New
 * standards start pre-filled with these two. Descriptions are required on all
 * rows (the requirements parser needs them, 2026-07-11), so these start with
 * editable defaults; they are never merged into a verification automatically.
 */
export const STARTER_REQUIREMENTS: Requirement[] = [
  {
    coverage_type: 'Matching Policyholder Name', minimum_limit: '', kind: 'condition',
    notes: 'The named insured on the COI matches the carrier name. Minor formatting differences or a DBA that explicitly lists the carrier still count as a match.',
  },
  {
    coverage_type: 'Policy Currently Active', minimum_limit: '', kind: 'condition',
    notes: 'Every coverage on the COI is in force today, with the effective date in the past and the expiration date in the future.',
  },
]

export interface TemplateVariable {
  key: string            // token name, e.g. 'asset_sale_price'
  label: string          // shown in the form, e.g. 'Asset sale price'
  /** Always 'text' now: per-deal values are free-form (dollar amounts, make/model/VIN, …).
   * 'currency' survives in rows saved before 2026-07-10; render those as text too. */
  type: 'currency' | 'text'
  required: boolean
}

export interface RequirementTemplate {
  id: string
  org_id: string
  name: string
  requirements: Requirement[]
  variables: TemplateVariable[]
  /** Optional free-text standards the rows don't capture (endorsements, extra conditions). */
  details?: string | null
  is_default: boolean
  created_at?: string
  updated_at?: string
}

export const TEMPLATE_SELECT = 'id, org_id, name, requirements, variables, details, is_default, created_at, updated_at'

/** List an org's templates, default first then A-Z. Pass any client; RLS scopes the session client. */
export async function listTemplates(db: SupabaseClient, orgId: string): Promise<RequirementTemplate[]> {
  const { data, error } = await db
    .from('requirement_templates')
    .select(TEMPLATE_SELECT)
    .eq('org_id', orgId)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw new Error(`Could not load templates: ${error.message}`)
  return (data ?? []) as RequirementTemplate[]
}

export function templateTokens(t: Pick<RequirementTemplate, 'requirements'>): string[] {
  const found = new Set<string>()
  for (const r of t.requirements ?? []) {
    for (const s of [r.minimum_limit, r.notes ?? '']) {
      for (const m of s.matchAll(/\{([a-z0-9_]+)\}/gi)) found.add(m[1])
    }
  }
  return [...found]
}

/** '{asset_sale_price}' / 'asset_sale_price' -> 'Asset sale price'. */
export function humanizeToken(key: string): string {
  const label = key.replaceAll('_', ' ').trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/** 'Asset Sale Price' -> 'asset_sale_price'. */
export function slugifyVariable(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/**
 * Canonicalize editor rows for storage and derive the per-deal variable inputs.
 * A Variable row's Title ("Asset Sale Price") IS the variable: it becomes the
 * per-deal input label and the stored {asset_sale_price} token, so the
 * substitution machinery is unchanged. Raw {tokens} typed into limits or notes
 * still work and derive variables too. {carrier_name} is never asked for: it is
 * filled from the verification's carrier field automatically.
 */
export function normalizeRequirementRows(raw: Requirement[]): {
  requirements: Requirement[]
  variables: TemplateVariable[]
  error?: string
} {
  const requirements: Requirement[] = []
  const variables: TemplateVariable[] = []
  const seen = new Set<string>(['carrier_name'])
  let error: string | undefined
  for (const r of raw) {
    const coverage_type = (r.coverage_type ?? '').trim()
    if (!coverage_type) continue
    const kind = requirementKind(r)
    let minimum_limit = kind === 'condition' ? '' : (r.minimum_limit ?? '').trim()
    if (kind === 'variable') {
      const key = slugifyVariable(coverage_type)
      if (!key) {
        // Title has no sluggable characters. Record the error and skip ONLY
        // this row — the /app/new form derives its per-deal inputs from this
        // function on every keystroke, and wiping all rows/variables here made
        // every prompt vanish mid-edit. All callers treat `error` as blocking,
        // so saving/submitting still can't proceed.
        error ??= `Give the variable requirement a title (for example "Asset Sale Price").`
        continue
      }
      minimum_limit = `{${key}}`
      if (!seen.has(key)) {
        seen.add(key)
        variables.push({ key, label: coverage_type, type: 'text', required: true })
      }
    }
    // Descriptions are required on every row: the requirements parser needs
    // them to expand a bare title into a checkable requirement (a description-
    // less condition made VRF-1043 unparseable). Same non-destructive contract
    // as above: record the error, skip only this row.
    if (!(r.notes ?? '').trim()) {
      error ??= `Add a description for "${coverage_type}".`
      continue
    }
    requirements.push({ coverage_type, minimum_limit, notes: (r.notes ?? '').trim(), kind })
  }
  for (const found of templateTokens({ requirements })) {
    const key = found.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    variables.push({
      key,
      label: humanizeToken(key),
      type: 'text',
      required: true,
    })
  }
  return { requirements, variables, error }
}

/**
 * Stored rows -> editor rows: variable rows drop their {token} — the Amount
 * cell is locked in the editor and the token re-derives from the Title on save.
 */
export function editableRows(t: Pick<RequirementTemplate, 'requirements' | 'variables'>): Requirement[] {
  return (t.requirements ?? []).map(r => {
    const token = (r.minimum_limit ?? '').trim().match(VARIABLE_TOKEN_RE)
    if (token && requirementKind(r) === 'variable') {
      return { ...r, kind: 'variable' as const, minimum_limit: '' }
    }
    return { ...r }
  })
}

/**
 * Split one submitted-standards line into display parts. Template submissions
 * serialize rows as "Coverage type: limit (notes)" (resolveTemplate below), so
 * peel the trailing (notes) then the ": limit"; free-text lines that don't
 * match just come back whole as the title. Shared by the admin detail page,
 * the customer report, and the report PDF.
 */
export function parseStandardLine(line: string): { title: string; limit?: string; notes?: string } {
  let head = line
  let notes: string | undefined
  const open = head.indexOf(' (')
  if (head.endsWith(')') && open > 0) {
    notes = head.slice(open + 2, -1).trim()
    head = head.slice(0, open).trim()
  }
  const colon = head.indexOf(': ')
  if (colon > 0) return { title: head.slice(0, colon).trim(), limit: head.slice(colon + 2).trim(), notes }
  return { title: head, notes }
}

export interface ResolvedTemplate {
  /** Serialized requirements text — same shape the manual web form produces. */
  text: string
  requirements: Requirement[]
  provenance: { template_id: string; template_name: string; variables: Record<string, string> }
}

/**
 * Substitute variable values into the template rows and serialize to the
 * requirements text the pipeline already understands. `{carrier_name}`-style
 * tokens without a supplied value are left intact for baselineRequirements-style
 * handling; missing REQUIRED template variables throw.
 */
export function resolveTemplate(
  template: RequirementTemplate,
  values: Record<string, string>,
): ResolvedTemplate {
  for (const v of template.variables ?? []) {
    if (v.required && !values[v.key]?.trim()) {
      throw new Error(`Missing value for "${v.label || v.key}".`)
    }
  }
  const sub = (s: string) => Object.entries(values).reduce(
    (acc, [k, val]) => acc.replaceAll(`{${k}}`, val.trim()), s,
  )
  const requirements: Requirement[] = (template.requirements ?? []).map(r => ({
    ...r,
    coverage_type: sub(r.coverage_type),
    minimum_limit: sub(r.minimum_limit),
    notes: r.notes ? sub(r.notes) : r.notes,
  }))
  const lines = requirements.map(r => {
    const note = (r.notes ?? '').trim()
    const limit = r.minimum_limit.trim()
    return `${r.coverage_type.trim()}${limit ? `: ${limit}` : ''}${note ? ` (${note})` : ''}`
  })
  if (template.details?.trim()) lines.push(`Additional details: ${sub(template.details.trim())}`)
  const text = lines.join('\n')
  return {
    text,
    requirements,
    provenance: {
      template_id: template.id,
      template_name: template.name,
      variables: values,
    },
  }
}
