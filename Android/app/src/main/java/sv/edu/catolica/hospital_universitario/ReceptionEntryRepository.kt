package sv.edu.catolica.hospital_universitario

import java.text.Normalizer
import java.time.LocalDate
import java.util.Locale

enum class ReceptionList { APPOINTMENTS, ADMISSIONS, QUEUE }

/** Adaptador de las listas existentes. El UUID remoto vive en Entry.remoteId. */
class ReceptionEntryRepository(
    private val repository: ReceptionRepository,
    private val kind: ReceptionList
) : EntryRepository {
    @Volatile private var entries: List<Entry> = emptyList()
    override fun refresh() {
        val token = SessionManager.requireAccessToken()
        val loaded = when (kind) {
            ReceptionList.APPOINTMENTS -> repository.appointments()
            ReceptionList.ADMISSIONS -> repository.admissions()
            ReceptionList.QUEUE -> repository.appointments(LocalDate.now(java.time.ZoneId.of("America/El_Salvador")))
        }
        if (runCatching { SessionManager.requireAccessToken() }.getOrNull() == token) entries = loaded
    }
    override fun clear() { entries = emptyList() }
    override fun getAll(): List<Entry> = entries
    override fun getById(id: Long): Entry? = entries.firstOrNull { it.id == id }
    override fun search(query: String): List<Entry> {
        val q = normalize(query)
        return entries.filter { normalize(it.displayTitle + " " + it.meta).contains(q) }
    }
    override fun add(entry: Entry): Entry = throw AuthException(R.string.remote_use_actions)
    override fun update(entry: Entry): Boolean = throw AuthException(R.string.remote_use_actions)
    override fun delete(id: Long): Boolean = throw AuthException(R.string.remote_use_actions)
    override fun nextCode(prefix: String): String = throw AuthException(R.string.remote_use_actions)
    private fun normalize(value: String): String =
        Normalizer.normalize(value.trim().lowercase(Locale.ROOT), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
}
