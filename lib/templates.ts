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
 * standards start pre-filled with these two, notes intentionally blank so the
 * org describes the check in their own words; they are never merged into a
 * verification automatically.
 */
export const STARTER_REQUIREMENTS: Requirement[] = [
  { coverage_type: 'Matching Policyholder Name', minimum_limit: '', kind: 'condition', notes: '' },
  { coverage_type: 'Policy Currently Active', minimum_limit: '', kind: 'condition', notes: '' },
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
 * Variable rows arrive with the human title the user typed in the Amount cell
 * ("Asset Sale Price"); storage keeps the {asset_sale_price} token so the
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
      const token = minimum_limit.match(VARIABLE_TOKEN_RE)
      const key = token ? token[1].toLowerCase() : slugifyVariable(minimum_limit)
      if (!key) {
        // In-progress Variable row: title typed, value name still empty. Record
        // the error and skip ONLY this row — the /app/new form derives its
        // per-deal inputs from this function on every keystroke, and wiping all
        // rows/variables here made every prompt vanish mid-edit. All callers
        // treat `error` as blocking, so saving/submitting still can't proceed.
        error ??= `Name the per-deal value for "${coverage_type}" (for example "Asset Sale Price").`
        continue
      }
      minimum_limit = `{${key}}`
      if (!seen.has(key)) {
        seen.add(key)
        variables.push({ key, label: token ? humanizeToken(key) : (r.minimum_limit ?? '').trim(), type: 'text', required: true })
      }
    }
    requirements.push({ coverage_type, minimum_limit, notes: (r.notes ?? '').trim() || null, kind })
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
 * Stored rows -> editor rows: variable rows swap their {token} for the human
 * title shown while editing (the saved variable label when we have it).
 */
export function editableRows(t: Pick<RequirementTemplate, 'requirements' | 'variables'>): Requirement[] {
  const labels = new Map((t.variables ?? []).map(v => [v.key, v.label]))
  return (t.requirements ?? []).map(r => {
    const token = (r.minimum_limit ?? '').trim().match(VARIABLE_TOKEN_RE)
    if (token && requirementKind(r) === 'variable') {
      const key = token[1].toLowerCase()
      return { ...r, kind: 'variable' as const, minimum_limit: labels.get(key) ?? humanizeToken(key) }
    }
    return { ...r }
  })
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
