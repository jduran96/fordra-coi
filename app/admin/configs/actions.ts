'use server'

import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/auth-helpers'
import { CONFIG_KEYS, setConfig, deleteConfig } from '@/lib/config'
import type { Requirement } from '@/lib/types'

/**
 * Save the baseline requirement checklist. Rows with an empty name are dropped,
 * which is also how a row is deleted. An empty list resets to the defaults.
 */
export async function saveBaselineConfig(formData: FormData) {
  await requireAdmin()
  const count = Number(formData.get('row_count') || 0)
  const items: Requirement[] = []
  for (let i = 0; i < count; i++) {
    const coverage_type = String(formData.get(`b_${i}_type`) || '').trim()
    if (!coverage_type) continue
    items.push({
      coverage_type,
      minimum_limit: String(formData.get(`b_${i}_limit`) || '').trim(),
      notes: String(formData.get(`b_${i}_notes`) || '').trim() || null,
    })
  }
  if (items.length) await setConfig(CONFIG_KEYS.baselineRequirements, items)
  else await deleteConfig(CONFIG_KEYS.baselineRequirements)
  revalidatePath('/admin/configs')
}

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
  revalidatePath('/admin/configs')
}
