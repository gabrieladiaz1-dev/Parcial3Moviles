import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Icon } from './Icon'
import { displayTime } from '../lib/reception'
import { markNotificationRead, panelError, panelRoleName, readNotifications, readPanelProfile, readPreferences, type PanelNotification, type PanelNotifications, type PanelProfile } from '../lib/panel'
import type { Page, IconName } from '../types'
import { panelNoticeTarget } from '../lib/panelNavigation'
import './Topbar.css'

export function Topbar({ session, onSignOut, onNavigate, isAdministrator, onOpenNotification }: { session: Session; onSignOut: () => Promise<void>; onNavigate: (page: Page) => void; isAdministrator: boolean; onOpenNotification: (notice: PanelNotification) => void }) {
  const [profile, setProfile] = useState<PanelProfile | null>(null); const [profileError, setProfileError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false); const [bellOpen, setBellOpen] = useState(false)
  const [notices, setNotices] = useState<PanelNotifications | null>(null); const [page, setPage] = useState(0); const [pollSeconds, setPollSeconds] = useState(60)
  const [loading, setLoading] = useState(true); const [noticeError, setNoticeError] = useState(''); const [working, setWorking] = useState(false); const [signingOut, setSigningOut] = useState(false)
  const root = useRef<HTMLElement>(null); const profileButton = useRef<HTMLButtonElement>(null); const bellButton = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null)
  const noticeLock = useRef(false); const loadSequence = useRef(0)
  useEffect(() => {
    let active = true
    const load = () => { void readPanelProfile().then(p => { if (active) { setProfile(p); setProfileError('') } }).catch(e => { if (active) setProfileError(panelError(e)) }) }
    const prefs = () => { void readPreferences().then(p => { if (active) setPollSeconds(p.poll_seconds) }).catch(() => { /* The default refresh interval remains usable. */ }) }
    load(); prefs(); window.addEventListener('panel-profile-updated', load); window.addEventListener('panel-preferences-updated', prefs)
    return () => { active = false; window.removeEventListener('panel-profile-updated', load); window.removeEventListener('panel-preferences-updated', prefs) }
  }, [session.user.id])
  const loadNotices = useCallback(async () => {
    const sequence = ++loadSequence.current; setLoading(true)
    try { const result = await readNotifications(page * 30); if (sequence === loadSequence.current) { setNotices(result); setNoticeError('') } }
    catch { if (sequence === loadSequence.current) setNoticeError('No se pudieron actualizar tus avisos.') }
    finally { if (sequence === loadSequence.current) setLoading(false) }
  }, [page])
  useEffect(() => {
    void loadNotices()
    const refresh = () => { if (document.visibilityState === 'visible') void loadNotices() }
    const timer = window.setInterval(refresh, pollSeconds * 1000)
    window.addEventListener('focus', refresh)
    return () => { ++loadSequence.current; window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [loadNotices, pollSeconds])
  useEffect(() => {
    const outside = (e: PointerEvent) => { if (root.current && !root.current.contains(e.target as Node)) { setMenuOpen(false); setBellOpen(false) } }
    const escape = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { if (menuOpen) { setMenuOpen(false); profileButton.current?.focus() } if (bellOpen) { setBellOpen(false); bellButton.current?.focus() } } }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [menuOpen, bellOpen])
  function openMenu() { setBellOpen(false); setMenuOpen(v => !v); if (!menuOpen) window.requestAnimationFrame(() => menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()) }
  function menuKeys(e: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length; buttons[next]?.focus() }
    if (e.key === 'Tab') setMenuOpen(false)
  }
  async function mark(id: string | null, notice?: PanelNotification) { if (noticeLock.current) return; noticeLock.current = true; setWorking(true); try { await markNotificationRead(id); await loadNotices(); if (notice) { setBellOpen(false); onOpenNotification(notice) } } catch (e) { setNoticeError(panelError(e)) } finally { noticeLock.current = false; setWorking(false) } }
  const name = profile ? `${profile.first_name} ${profile.last_name}`.trim() || profile.email : session.user.email || 'Mi cuenta'
  const initials = name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
  const links: { page: Page; icon: IconName }[] = [{ page: 'Mi perfil', icon: 'patient' }, ...(isAdministrator ? [{ page: 'Configuración' as const, icon: 'more' as const }] : []), { page: 'Acerca del hospital', icon: 'help' }, { page: 'Cómo llegar', icon: 'arrow' }]
  return <header className="panel-topbar" ref={root}><div className="topbar-brand"><span><Icon name="plus" size={19} /></span><div><strong>Hospital Móviles</strong><small>Panel del personal</small></div></div><div className="topbar-controls">
    <div className="topbar-dropdown-anchor"><button ref={bellButton} className="topbar-bell" aria-label={`Notificaciones${notices?.unread ? `, ${notices.unread} sin leer` : ''}`} aria-expanded={bellOpen} aria-controls="panel-notifications" onClick={() => { setBellOpen(v => !v); setMenuOpen(false); if (!bellOpen) void loadNotices() }}><Icon name="bell" size={21} />{!!notices?.unread && <span className="topbar-notice-count">{notices.unread > 99 ? '99+' : notices.unread}</span>}</button>
      {bellOpen && <section className="topbar-notifications" id="panel-notifications" aria-label="Tus notificaciones"><div className="topbar-dropdown-heading"><div><h2>Notificaciones</h2><p>{notices?.unread ?? '—'} sin leer</p></div><button className="topbar-text-button" disabled={working || !notices?.unread} onClick={() => void mark(null)}>Marcar todas leídas</button></div>{noticeError && <p className="topbar-dropdown-error" role="alert">{noticeError}<button onClick={() => void loadNotices()}>Reintentar</button></p>}{loading && <p className="topbar-dropdown-status" role="status">Actualizando avisos…</p>}<div className="topbar-notice-list">{notices?.items.map(n => <article className={n.read_at ? 'notice-read' : 'notice-unread'} key={n.id}><div className="topbar-notice-title"><span className="topbar-notice-dot" /><strong>{n.title}</strong>{!n.read_at && <small>Nuevo</small>}</div><p>{n.body}</p><time>{displayTime(n.created_at)}</time><div className="topbar-notice-actions">{panelNoticeTarget(n) && <button disabled={working} onClick={() => void mark(n.id, n)}>Abrir registro →</button>}{!n.read_at && <button disabled={working} onClick={() => void mark(n.id)}>Marcar como leída</button>}</div></article>)}{notices && !notices.items.length && !loading && <div className="topbar-notice-empty"><Icon name="bell" size={30} /><strong>No tienes avisos en esta página</strong><p>Aquí aparecerán las novedades que requieren tu atención.</p></div>}</div><div className="topbar-notice-pagination"><button disabled={loading || page === 0} onClick={() => setPage(v => Math.max(0, v - 1))}>Anteriores</button><button disabled={loading} onClick={() => { setPage(0); void loadNotices() }}>Actualizar</button><button disabled={loading || !notices?.has_more} onClick={() => setPage(v => v + 1)}>Más avisos</button></div></section>}
    </div>
    <div className="topbar-dropdown-anchor"><button ref={profileButton} className="topbar-account" aria-haspopup="menu" aria-expanded={menuOpen} aria-controls="panel-account-menu" onClick={openMenu} onKeyDown={e => { if (e.key === 'ArrowDown') { e.preventDefault(); if (!menuOpen) openMenu(); else menu.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus() } }}><span className="topbar-avatar">{initials}</span><span className="topbar-account-name"><strong>{name}</strong><small>{profile?.roles.map(panelRoleName).join(' · ') || 'Cargando cuenta…'}</small></span><Icon name="chevron" size={15} className={menuOpen ? '-rotate-90' : 'rotate-90'} /></button>
      {menuOpen && <div ref={menu} id="panel-account-menu" role="menu" aria-label="Menú de mi cuenta" className="topbar-account-menu" onKeyDown={menuKeys}><div className="topbar-menu-user"><strong>{name}</strong><small>{profile?.email || session.user.email}</small></div>{profileError && <p className="topbar-dropdown-error">No se pudo actualizar tu perfil.</p>}{links.map(link => <button role="menuitem" key={link.page} onClick={() => { setMenuOpen(false); onNavigate(link.page) }}><Icon name={link.icon} size={17} />{link.page}</button>)}<button role="menuitem" className="topbar-signout" disabled={signingOut} onClick={async () => { if (signingOut) return; setSigningOut(true); try { await onSignOut() } catch (e) { setProfileError(panelError(e)) } finally { setSigningOut(false) } }}><Icon name="arrowRight" size={17} />{signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</button></div>}
    </div>
  </div></header>
}
