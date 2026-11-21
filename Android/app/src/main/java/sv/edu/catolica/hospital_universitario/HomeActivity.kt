package sv.edu.catolica.hospital_universitario

import android.os.Bundle
import com.google.android.material.snackbar.Snackbar
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import androidx.appcompat.app.AppCompatActivity
import sv.edu.catolica.hospital_universitario.databinding.ActivityHomeBinding

class HomeActivity : AppCompatActivity() {

    private lateinit var binding: ActivityHomeBinding
    private val repository: ReceptionRepository = AppContainer.receptionRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
    }

    override fun onResume() {
        super.onResume()
        val user = SessionManager.currentUser
        if (user == null) {
            Navigator.goToLogin(this, closeCurrent = true)
            return
        }
        binding.tvGreeting.text = getString(R.string.remote_greeting, user.displayName)
        val day = LocalDate.now(java.time.ZoneId.of("America/El_Salvador"))
        binding.tvDateSubtitle.text = getString(R.string.remote_reception_date,
            day.format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", Locale("es"))))
        loadSummary(day)
    }

    private fun loadSummary(day: LocalDate) {
        val counters = listOf(binding.tvAppointmentsCount, binding.tvWaitingCount,
            binding.tvAdmissionsCount, binding.tvFreeBedsCount)
        counters.forEach { it.setText(R.string.remote_placeholder) }
        val user = SessionManager.currentUser
        AppContainer.ioExecutor.execute {
            val result = runCatching { repository.summary(day) }
            runOnUiThread {
                if (isDestroyed || isFinishing || SessionManager.currentUser !== user) return@runOnUiThread
                result.fold(onSuccess = { summary ->
                    binding.tvAppointmentsCount.text = getString(R.string.remote_number, summary.appointments)
                    binding.tvWaitingCount.text = summary.waiting?.let { getString(R.string.remote_number, it) }
                        ?: getString(R.string.remote_placeholder)
                    binding.tvAdmissionsCount.text = getString(R.string.remote_number, summary.admissions)
                    binding.tvFreeBedsCount.text = getString(R.string.remote_number, summary.freeBeds)
                }, onFailure = { error ->
                    Snackbar.make(binding.root, (error as? AuthException)?.messageRes
                        ?: R.string.remote_operation_error, Snackbar.LENGTH_INDEFINITE)
                        .setAction(R.string.remote_retry) { loadSummary(day) }.show()
                })
            }
        }
    }

    private fun setupListeners() {
        // Search bar click
        binding.cardSearch.setOnClickListener {
            Navigator.goToPatients(this)
        }

        // Quick Actions clicks
        binding.cardAction1.setOnClickListener {
            // Navigate to PatientsActivity
            Navigator.goToPatients(this)
        }

        binding.cardAction2.setOnClickListener {
            // Navigate to AppointmentsActivity
            Navigator.goToAppointments(this)
        }

        binding.cardAction3.setOnClickListener {
            // Navigate to AdmissionsActivity
            Navigator.goToAdmissions(this)
        }

        binding.cardAction4.setOnClickListener {
            // Navigate to RoomsActivity
            Navigator.goToRooms(this)
        }

        // Bottom Navigation (Recepción)
        Navigator.setupBottomNav(
            activity = this,
            currentTab = Navigator.ReceptionTab.HOME,
            tabInicio = binding.tabInicio,
            tabPacientes = binding.tabPacientes,
            tabCitas = binding.tabCitas,
            tabTurnos = binding.tabTurnos,
            tabMas = binding.tabMas
        )
    }
}
