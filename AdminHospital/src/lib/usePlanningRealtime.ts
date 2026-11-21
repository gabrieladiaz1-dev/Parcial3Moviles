import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'

// The replicated row contains only a revision, never employee or patient data.
export function usePlanningRealtime(onChange?: () => void) {
  const [revision, setRevision] = useState(0)
  const [connected, setConnected] = useState(false)
  const callback = useRef(onChange)
  useEffect(() => { callback.current = onChange }, [onChange])
  useEffect(() => {
    if (!supabase) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (active) { setRevision(r => r + 1); callback.current?.() }
      }, 120)
    }
    const channel = supabase.channel(`planning:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'planning_revision' }, refresh)
      .subscribe(status => {
        if (!active) return
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') refresh() // Reconcile events missed during reconnect.
      })
    const visible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', visible)
    const fallback = setInterval(refresh, 30000)
    return () => {
      active = false; clearTimeout(timer); clearInterval(fallback)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', visible)
      void supabase?.removeChannel(channel)
    }
  }, [])
  return { revision, connected }
}
