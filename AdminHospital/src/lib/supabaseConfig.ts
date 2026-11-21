export const productionProjectRef = 'uvebpsbbwofthucghccc'

export function resolveSupabaseUrl(configuredUrl: string | undefined, mode: string, stagingRef?: string): string | null {
  const expectedRef = mode === 'staging'
    ? stagingRef && /^[a-z0-9]{20}$/.test(stagingRef) && stagingRef !== productionProjectRef ? stagingRef : null
    : productionProjectRef
  if (!expectedRef) return null
  try {
    const url = new URL(configuredUrl ?? '')
    return url.protocol === 'https:' && url.hostname === `${expectedRef}.supabase.co` && !url.username && !url.password
      ? url.origin : null
  } catch { return null }
}
