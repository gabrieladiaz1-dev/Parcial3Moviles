import { createClient } from '@supabase/supabase-js'
import { resolveSupabaseUrl } from './supabaseConfig'

const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
// Production remains pinned; an explicit staging build cannot connect to production.
const stagingRef = import.meta.env.VITE_STAGING_SUPABASE_PROJECT_REF?.trim()
const supabaseUrl = resolveSupabaseUrl(configuredUrl, import.meta.env.MODE, stagingRef)
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const supabase =
  supabaseUrl && publishableKey
    ? createClient(supabaseUrl, publishableKey, {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
          storageKey: import.meta.env.MODE === 'staging' ? `hospital-moviles-staging-${stagingRef}` : 'hospital-moviles-auth',
        },
      })
    : null
