import type { SupabaseClient } from '@supabase/supabase-js'
import type { Requirement } from '@/lib/types'

/**
 * Insurance-standards templates: org-saved requirement sets selectable at
 * submission time (web picker, /v1 template_id, Slack). Rows may contain
 * {token} placeholders resolved per deal from `variables` — e.g. Dakota's
 * physical-damage limit is "{asset_sale_price}".
 */

/**
 * Condition rows every logistics broker/factor tends to want on a COI. New
 * templates start pre-filled with these so orgs can see and tailor them; they
 * are never merged into a verification automatically. `{carrier_name}` resolves
 * from the verification's carrier field at submission time.
 */
export const STARTER_REQUIREMENTS: Requirement[] = [
  {
    coverage_type: 'Matching Policyholder Name',
    minimum_limit: '',
    kind: 'condition',
    notes: 'The named insured on the COI must be the carrier "{carrier_name}". Minor formatting differences (punctuation, casing, LLC vs L.L.C.) still count as a match; a DBA explicitly listing the carrier also counts. Owner-operator certificates: if the carrier is not the named insured but appears elsewhere on the certificate (other_named_parties, additional_insured, a scheduled driver or DBA), this is uncertain, and the evidence must say where the name was found. Only a carrier appearing nowhere on the certificate is not met.',
  },
  {
    coverage_type: 'Policy Currently Active',
    minimum_limit: '',
    kind: 'condition',
    notes: 'Every coverage on the COI must be in force today: effective date in the past, expiration date in the future. If any listed coverage is expired or not yet effective, this is not met. If dates are missing or illegible, this is uncertain.',
  },
  {
    coverage_type: 'No Unusual Exclusions',
    minimum_limit: '',
    kind: 'condition',
    notes: 'Review conditions_and_exceptions on each coverage for exclusions that would matter to a freight broker (commodity exclusions, radius restrictions, unattended-vehicle or scheduled-vehicle-only clauses). Met if none are present; not_met if a clearly restrictive exclusion appears; uncertain if the certificate text is ambiguous.',
  },
]

export interface TemplateVariable {
  key: string            // token name, e.g. 'asset_sale_price'
  label: string          // shown in the form, e.g. 'Asset sale price'
  type: 'currency' | 'text'
  required: boolean
}

export interface RequirementTemplate {
  id: string
  org_id: string
  name: string
  requirements: Requirement[]
  variables: TemplateVariable[]
  is_default: boolean
  created_at?: string
  updated_at?: string
}

export const TEMPLATE_SELECT = 'id, org_id, name, requirements, variables, is_default, created_at, updated_at'

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
  const text = requirements.map(r => {
    const note = (r.notes ?? '').trim()
    const limit = r.minimum_limit.trim()
    return `${r.coverage_type.trim()}${limit ? `: ${limit}` : ''}${note ? ` (${note})` : ''}`
  }).join('\n')
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
