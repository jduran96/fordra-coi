import { createServiceClient } from '@/lib/supabase/server'
import type { Requirement } from '@/lib/types'

/**
 * Admin-editable runtime config, stored in the `app_config` table.
 * Every key is optional: absent → the hardcoded default in lib/claude.ts applies.
 * Edited on /admin/configs.
 */
export const CONFIG_KEYS = {
  baselineRequirements: 'baseline_requirements',        // Requirement[]; notes may use {carrier_name}
  promptCoiExtraction: 'prompt_coi_extraction',         // string — system prompt for COI vision OCR
  promptDocTextExtraction: 'prompt_doc_text_extraction',// string — instruction for rate con / standards text OCR
  promptRequirementsParsing: 'prompt_requirements_parsing', // string — system prompt for requirements parsing
} as const

export interface ExtractionConfig {
  baselineRequirements?: Requirement[]
  promptCoiExtraction?: string
  promptDocTextExtraction?: string
  promptRequirementsParsing?: string
}

/** Load all extraction-related config overrides in one query. */
export async function getExtractionConfig(): Promise<ExtractionConfig> {
  const svc = createServiceClient()
  const { data } = await svc.from('app_config').select('key, value')
  const map = new Map((data ?? []).map(r => [r.key, r.value]))
  return {
    baselineRequirements: (map.get(CONFIG_KEYS.baselineRequirements) as Requirement[] | undefined) ?? undefined,
    promptCoiExtraction: (map.get(CONFIG_KEYS.promptCoiExtraction) as string | undefined) || undefined,
    promptDocTextExtraction: (map.get(CONFIG_KEYS.promptDocTextExtraction) as string | undefined) || undefined,
    promptRequirementsParsing: (map.get(CONFIG_KEYS.promptRequirementsParsing) as string | undefined) || undefined,
  }
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  const svc = createServiceClient()
  const { error } = await svc.from('app_config').upsert({ key, value, updated_at: new Date().toISOString() })
  if (error) throw new Error(`Could not save config ${key}: ${error.message}`)
}

export async function deleteConfig(key: string): Promise<void> {
  const svc = createServiceClient()
  await svc.from('app_config').delete().eq('key', key)
}
