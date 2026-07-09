'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { createServiceClient } from '@/lib/supabase/server'
import { CONFIG_KEYS, setConfig, deleteConfig } from '@/lib/config'
import type { Requirement } from '@/lib/types'
import { requirementKind } from '@/lib/types'
import type { TemplateVariable } from '@/lib/templates'
import { templateTokens } from '@/lib/templates'

const PROMPT_KEYS: Record<string, string> = {
  coi: CONFIG_KEYS.promptCoiExtraction,
  doc_text: CONFIG_KEYS.promptDocTextExtraction,
  requirements: CONFIG_KEYS.promptRequirementsParsing,
}

/** Save or reset one of the OCR prompts. Empty text or intent=reset restores the default. */
export async function savePrompt(which: string, formData: FormData) {
  await requireAdmin()
  const key = PROMPT_KEYS[which]
  if (!key) return
  const reset = String(formData.get('intent') || '') === 'reset'
  const text = String(formData.get('prompt') || '').trim()
  if (reset || !text) await deleteConfig(key)
  else await setConfig(key, text)
  revalidatePath('/admin/settings')
}

export interface OrgTemplateState { ok?: boolean; error?: string }

function humanize(key: string): string {
  const label = key.replaceAll('_', ' ').trim()
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function deriveVariables(requirements: Requirement[]): TemplateVariable[] {
  return templateTokens({ requirements }).filter(key => key !== 'carrier_name').map(key => ({
    key,
    label: humanize(key),
    type: /price|amount|limit|value/.test(key) ? 'currency' : 'text',
    required: true,
  }))
}

/**
 * Create or update an insurance-standards template on behalf of an org.
 * It appears on that org's /app Settings page, where they can edit it further.
 */
export async function saveOrgTemplate(_prev: OrgTemplateState, formData: FormData): Promise<OrgTemplateState> {
  const admin = await requireAdmin()
  const supabase = createServiceClient()

  const id = String(formData.get('id') || '').trim()
  const orgId = String(formData.get('org_id') || '').trim()
  const name = String(formData.get('name') || '').trim()
  if (!orgId) return { error: 'Pick an org.' }
  if (!name) return { error: 'Give the standard a name.' }

  let requirements: Requirement[]
  try {
    requirements = JSON.parse(String(formData.get('rows') || '[]'))
  } catch {
    return { error: 'Could not read the requirement rows.' }
  }
  requirements = requirements
    .map(r => {
      const kind = requirementKind(r)
      return {
        coverage_type: (r.coverage_type ?? '').trim(),
        minimum_limit: kind === 'condition' ? '' : (r.minimum_limit ?? '').trim(),
        notes: (r.notes ?? '').trim() || null,
        kind,
      }
    })
    .filter(r => r.coverage_type)
  if (requirements.length === 0) return { error: 'Add at least one requirement row.' }

  const isDefault = String(formData.get('is_default') || '') === 'true'
  // One default per org (partial unique index): clear the old one first.
  if (isDefault) {
    await supabase.from('requirement_templates')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('is_default', true)
  }

  const row = {
    org_id: orgId,
    name,
    requirements,
    variables: deriveVariables(requirements),
    is_default: isDefault,
    updated_at: new Date().toISOString(),
  }
  const { error } = id
    ? await supabase.from('requirement_templates').update(row).eq('id', id).eq('org_id', orgId)
    : await supabase.from('requirement_templates').insert({ ...row, created_by: admin.id })
  if (error) return { error: error.message }

  revalidatePath('/admin/settings')
  return { ok: true }
}

export async function deleteOrgTemplate(templateId: string): Promise<void> {
  await requireAdmin()
  const supabase = createServiceClient()
  await supabase.from('requirement_templates').delete().eq('id', templateId)
  revalidatePath('/admin/settings')
}
