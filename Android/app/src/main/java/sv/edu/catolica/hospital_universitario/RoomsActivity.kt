package sv.edu.catolica.hospital_universitario

import android.os.Bundle
import android.view.View
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import androidx.appcompat.app.AppCompatActivity
import sv.edu.catolica.hospital_universitario.databinding.ActivityRoomsBinding

class RoomsActivity : AppCompatActivity() {

    private lateinit var binding: ActivityRoomsBinding
    private val repository: ReceptionRepository = AppContainer.receptionRepository
    private var beds: List<HospitalBed> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityRoomsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        if (SessionManager.currentUser == null) {
            Navigator.goToLogin(this, closeCurrent = true)
            return
        }
        loadBeds()
    }

    private fun loadBeds() {
        beds = emptyList()
        binding.tvTotalBeds.setText(R.string.remote_placeholder)
        binding.tvAvailableBeds.setText(R.string.remote_placeholder)
        binding.tvSemiSubtitle.setText(R.string.remote_loading)
        val cards = listOf(binding.cardRoom1, binding.cardRoom2, binding.cardRoom3, binding.cardRoom4, binding.cardRoom5)
        cards.forEach { it.isEnabled = false }
        val user = SessionManager.currentUser
        AppContainer.ioExecutor.execute {
            val result = runCatching { repository.beds() }
            runOnUiThread {
                if (isDestroyed || isFinishing || SessionManager.currentUser !== user) return@runOnUiThread
                result.fold(onSuccess = { loaded ->
                    beds = loaded
                    binding.tvTotalBeds.text = getString(R.string.remote_number, beds.size)
                    binding.tvAvailableBeds.text = getString(R.string.remote_number, beds.count { it.state == "disponible" })
                    val vip = beds.filter { it.kind == "vip" }.groupBy { it.room }.entries.toList()
                    val names = listOf(binding.tvRoom1, binding.tvRoom2, binding.tvRoom3, binding.tvRoom4, binding.tvRoom5)
                    val states = listOf(binding.tvRoomStatus1, binding.tvRoomStatus2, binding.tvRoomStatus3,
                        binding.tvRoomStatus4, binding.tvRoomStatus5)
                    cards.forEachIndexed { index, card ->
                        val room = vip.getOrNull(index)
                        card.visibility = if (room == null) View.INVISIBLE else View.VISIBLE
                        if (room != null) {
                            names[index].text = room.key
                            val state = room.value.first().state
                            states[index].setText(ReceptionStatuses.option(state).labelRes)
                            states[index].setBackgroundResource(ReceptionStatuses.option(state).style.badgeRes)
                            card.isEnabled = true
                            card.setOnClickListener { showBeds(room.value) }
                        }
                    }
                    val semi = beds.filter { it.kind == "semiprivada" }
                    binding.tvSemiSubtitle.text = getString(R.string.remote_room_capacity,
                        semi.map { it.room }.distinct().size, semi.size, semi.count { it.state == "disponible" })
                }, onFailure = { error ->
                    cards.forEach { it.visibility = View.INVISIBLE }
                    binding.tvSemiSubtitle.setText((error as? AuthException)?.messageRes ?: R.string.remote_operation_error)
                    Snackbar.make(binding.root, R.string.remote_operation_error, Snackbar.LENGTH_INDEFINITE)
                        .setAction(R.string.remote_retry) { loadBeds() }.show()
                })
            }
        }
    }

    private fun showAllBeds() {
        RemoteUi.run(this, { repository.beds() }) {
            beds = it
            showBeds(it)
        }
    }

    private fun showBeds(items: List<HospitalBed>) {
        MaterialAlertDialogBuilder(this).setTitle(R.string.remote_rooms_all)
            .setMessage(if (items.isEmpty()) getString(R.string.remote_rooms_empty) else
                items.joinToString("\n") {
                    getString(R.string.remote_bed_line, it.room, it.code, getString(ReceptionStatuses.option(it.state).labelRes))
                })
            .setPositiveButton(R.string.list_close, null).show()
    }

    private fun setupListeners() {
        binding.cardSearch.setOnClickListener { showAllBeds() }
        binding.tvConsultLink.setOnClickListener { showAllBeds() }
        binding.tvSemiSubtitle.setOnClickListener { showAllBeds() }

        // Bottom Navigation (Recepción)
        // "Habitaciones" no es una pestaña de la barra: ninguna queda marcada.
        Navigator.setupBottomNav(
            activity = this,
            currentTab = null,
            tabInicio = binding.tabInicio,
            tabPacientes = binding.tabPacientes,
            tabCitas = binding.tabCitas,
            tabTurnos = binding.tabTurnos,
            tabMas = binding.tabMas
        )
    }
}
