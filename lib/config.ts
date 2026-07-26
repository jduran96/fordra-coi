import { createServiceClient } from '@/lib/supabase/server'
import { DEFAULT_CALL_CONFIG, type OrgCallConfig } from '@/lib/call-config'

/**
 * Admin-editable runtime config, stored in the `app_config` table.
 * Every key is optional: absent → the hardcoded default in lib/claude.ts applies.
 * Edited on /admin/settings.
 */
export const CONFIG_KEYS = {
  promptCoiExtraction: 'prompt_coi_extraction',         // string — system prompt for COI vision OCR
  promptDocTextExtraction: 'prompt_doc_text_extraction',// string — instruction for rate con / standards text OCR
  promptRequirementsParsing: 'prompt_requirements_parsing', // string — system prompt for requirements parsing
} as const

export interface ExtractionConfig {
  promptCoiExtraction?: string
  promptDocTextExtraction?: string
  promptRequirementsParsing?: string
}

/** Load all extraction-related config overrides in one query. */
export async function getExtractionConfig(): Promise<ExtractionConfig> {
  const svc = createServiceClient()
  const { data, error } = await svc.from('app_config').select('key, value')
  // A transient read failure must fail loudly: silently falling back to the
  // defaults would run extraction with prompts the admin already replaced.
  if (error) throw new Error(`Could not load extraction config: ${error.message}`)
  const map = new Map((data ?? []).map(r => [r.key, r.value]))
  return {
    promptCoiExtraction: (map.get(CONFIG_KEYS.promptCoiExtraction) as string | undefined) || undefined,
    promptDocTextExtraction: (map.get(CONFIG_KEYS.promptDocTextExtraction) as string | undefined) || undefined,
    promptRequirementsParsing: (map.get(CONFIG_KEYS.promptRequirementsParsing) as string | undefined) || undefined,
  }
}

/**
 * AI call identity config (voice spec v5 §2): global defaults under
 * `call_config`, per-org overrides under `call_config:<orgId>`. Values are
 * partial OrgCallConfig objects; the merge order is hardcoded defaults <-
 * global <- org. Everything stays editable per dispatch on the review screen —
 * this is only the prefill.
 */
export const CALL_CONFIG_KEY = 'call_config'
export const callConfigOrgKey = (orgId: string) => `${CALL_CONFIG_KEY}:${orgId}`

export async function getCallConfig(orgId: string | null): Promise<OrgCallConfig> {
  const svc = createServiceClient()
  const keys = [CALL_CONFIG_KEY, ...(orgId ? [callConfigOrgKey(orgId)] : [])]
  const { data, error } = await svc.from('app_config').select('key, value').in('key', keys)
  if (error) throw new Error(`Could not load call config: ${error.message}`)
  const map = new Map((data ?? []).map(r => [r.key, r.value]))
  const global = (map.get(CALL_CONFIG_KEY) ?? {}) as Partial<OrgCallConfig>
  const org = orgId ? ((map.get(callConfigOrgKey(orgId)) ?? {}) as Partial<OrgCallConfig>) : {}
  const merged = { ...DEFAULT_CALL_CONFIG, ...global, ...org }
  // Drop blank overrides so an empty org field falls back to the global value.
  for (const k of Object.keys(merged) as (keyof OrgCallConfig)[]) {
    if (!String(merged[k] ?? '').trim()) merged[k] = DEFAULT_CALL_CONFIG[k] as never
  }
  return merged
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
