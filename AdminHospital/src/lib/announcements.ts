import { receptionRpc } from './reception'
import { localToIso, type Announcement, type AnnouncementInput } from './announcementRules'
export * from './announcementRules'

// Avisos públicos: gestión exclusiva de administración (supabase/migrations/20261121040000_public_announcements_admin.sql).
export const readAnnouncements = () => receptionRpc<Announcement[]>('admin_announcements', {})
export const saveAnnouncement = (input: AnnouncementInput, id?: string) => receptionRpc<string>('save_announcement', {
  p_title: input.title.trim(), p_content: input.content.trim(), p_is_public: input.isPublic,
  p_published_at: localToIso(input.publishedAt), p_expires_at: localToIso(input.expiresAt), p_id: id ?? null,
})
export const retireAnnouncement = (id: string) => receptionRpc<null>('retire_announcement', { p_id: id })
