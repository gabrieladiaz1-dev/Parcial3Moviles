package sv.edu.catolica.hospital_universitario

import android.os.Bundle
import android.text.InputType
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.LinearLayout
import java.time.LocalDate
import java.time.Period
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.widget.addTextChangedListener
import androidx.recyclerview.widget.LinearLayoutManager
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.snackbar.Snackbar
import sv.edu.catolica.hospital_universitario.databinding.ActivityPatientsBinding

class PatientsActivity : AppCompatActivity() {

    private lateinit var binding: ActivityPatientsBinding
    private val repository: PatientRepository = AppContainer.patientRepository
    private lateinit var adapter: PatientAdapter
    private var currentQuery: String = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // El teclado no sube la barra inferior ni el botón, y no aparece solo al abrir la pantalla
        window.setSoftInputMode(
            WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
        )
        binding = ActivityPatientsBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupList()
        setupListeners()
        refreshPatients()
    }

    private fun refreshPatients() {
        binding.tvEmpty.setText(R.string.patient_loading)
        binding.tvEmpty.visibility = View.VISIBLE
        AppContainer.ioExecutor.execute {
            val result = runCatching { repository.refresh() }
            runOnUiThread {
                if (isDestroyed || isFinishing) return@runOnUiThread
                loadPatients()
                result.exceptionOrNull()?.let {
                    binding.tvEmpty.setText((it as? AuthException)?.messageRes ?: R.string.auth_server_error)
                    binding.tvEmpty.visibility = View.VISIBLE
                    showMessage((it as? AuthException)?.messageRes ?: R.string.auth_server_error)
                }
            }
        }
    }

    private fun setupList() {
        adapter = PatientAdapter { patient -> showPatientDetail(patient) }
        binding.rvPatients.layoutManager = LinearLayoutManager(this)
        binding.rvPatients.adapter = adapter
    }

    /** Vuelve a leer del repositorio (aplicando la búsqueda actual) y actualiza la lista. */
    private fun loadPatients() {
        val patients = repository.search(currentQuery)
        adapter.submitList(patients)
        if (patients.isEmpty()) {
            binding.tvEmpty.text = if (currentQuery.isBlank()) {
                getString(R.string.patients_empty)
            } else {
                getString(R.string.patients_no_results, currentQuery)
            }
            binding.tvEmpty.visibility = View.VISIBLE
        } else {
            binding.tvEmpty.visibility = View.GONE
        }
    }

    private fun setupListeners() {
        setupSearch()
        binding.btnNewPatient.isEnabled = SessionManager.currentRole == SessionManager.Role.RECEPTION
        binding.btnNewPatient.setOnClickListener { showPatientForm(null) }

        // Bottom Navigation (Recepción)
        Navigator.setupBottomNav(
            activity = this,
            currentTab = Navigator.ReceptionTab.PATIENTS,
            tabInicio = binding.tabInicio,
            tabPacientes = binding.tabPacientes,
            tabCitas = binding.tabCitas,
            tabTurnos = binding.tabTurnos,
            tabMas = binding.tabMas
        )
    }

    // ---------------------------------------------------------------- búsqueda

    /** Búsqueda en la misma barra: filtra mientras se escribe. */
    private fun setupSearch() {
        // Tocar cualquier parte de la barra enfoca el campo y abre el teclado
        binding.cardSearch.setOnClickListener { focusSearch() }

        binding.etSearch.addTextChangedListener { text ->
            currentQuery = text?.toString().orEmpty().trim()
            binding.btnClearSearch.visibility =
                if (text.isNullOrEmpty()) View.GONE else View.VISIBLE
            loadPatients()
        }

        // Tecla "buscar" del teclado: cierra el teclado y deja el filtro aplicado
        binding.etSearch.setOnEditorActionListener { view, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_SEARCH) {
                hideKeyboard(view)
                view.clearFocus()
                true
            } else {
                false
            }
        }

        binding.btnClearSearch.setOnClickListener {
            binding.etSearch.text.clear()
            focusSearch()
        }
    }

    private fun focusSearch() {
        binding.etSearch.requestFocus()
        getSystemService(InputMethodManager::class.java)
            ?.showSoftInput(binding.etSearch, InputMethodManager.SHOW_IMPLICIT)
    }

    private fun hideKeyboard(view: View) {
        getSystemService(InputMethodManager::class.java)
            ?.hideSoftInputFromWindow(view.windowToken, 0)
    }

    // ----------------------------------------------------------------- detalle

    private fun showPatientDetail(patient: Patient) {
        val message = getString(
            R.string.patient_remote_detail,
            patient.fullName,
            patient.record,
            getString(patient.status.labelRes),
            patient.age?.let { getString(R.string.patient_age_value, it) } ?: getString(R.string.patient_unknown_age),
            patient.phone
        )
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.patients_detail_title)
            .setMessage(message)
            .setPositiveButton(R.string.patients_detail_edit) { _, _ -> showPatientForm(patient) }
            .setNegativeButton(R.string.patients_detail_close, null)
            .show()
    }

    // -------------------------------------------------------- crear / editar

    /** [existing] == null: crear paciente nuevo. Si no, editar ese paciente. */
    private fun showPatientForm(existing: Patient?) {
        if (SessionManager.currentRole != SessionManager.Role.RECEPTION) {
            showMessage(R.string.patient_write_denied)
            return
        }
        val etName = EditText(this).apply {
            hint = getString(R.string.patient_first_name)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            setText(existing?.firstName.orEmpty())
        }
        val etLastName = EditText(this).apply {
            hint = getString(R.string.patient_last_name)
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS
            setText(existing?.lastName.orEmpty())
        }
        val etBirth = EditText(this).apply {
            hint = getString(R.string.patient_birth_date)
            inputType = InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE
            setText(existing?.birthDate.orEmpty())
        }
        val etDui = EditText(this).apply {
            hint = getString(R.string.patient_dui)
            setText(existing?.dui.orEmpty())
        }
        val etCity = EditText(this).apply {
            hint = getString(R.string.patient_city)
            setText(existing?.city.orEmpty())
        }
        val etPhone = EditText(this).apply {
            hint = getString(R.string.patients_form_phone_hint)
            inputType = InputType.TYPE_CLASS_PHONE
            setText(existing?.phone.orEmpty())
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(8), dp(20), 0)
            addView(etName)
            addView(etLastName)
            addView(etBirth)
            addView(etPhone)
            addView(etDui)
            addView(etCity)
        }

        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle(
                if (existing == null) R.string.patients_form_title_new
                else R.string.patients_form_title_edit
            )
            .setView(container)
            .setPositiveButton(R.string.patients_form_save, null) // se define abajo para validar
            .setNegativeButton(R.string.patients_search_cancel, null)
            .create()

        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val name = etName.text.toString().trim()
                val lastName = etLastName.text.toString().trim()
                val birthText = etBirth.text.toString().trim()
                val birth = if (birthText.isEmpty()) null else runCatching {
                    LocalDate.parse(birthText)
                }.getOrNull()
                val dui = etDui.text.toString().trim().ifBlank { null }
                val city = etCity.text.toString().trim().ifBlank { null }
                val phoneDigits = etPhone.text.toString().filter { it.isDigit() }

                var valid = true
                if (name.isBlank()) {
                    etName.error = getString(R.string.patients_error_name)
                    valid = false
                }
                if (lastName.isBlank()) {
                    etLastName.error = getString(R.string.patients_error_name)
                    valid = false
                }
                if (birthText.isNotEmpty() && (birth == null || birth.isAfter(LocalDate.now()))) {
                    etBirth.error = getString(R.string.patient_date_error)
                    valid = false
                }
                if (dui != null && !Regex("^[0-9]{8}-[0-9]$").matches(dui)) {
                    etDui.error = getString(R.string.patient_dui_error)
                    valid = false
                }
                if (phoneDigits.isNotEmpty() && phoneDigits.length != 8) {
                    etPhone.error = getString(R.string.patients_error_phone)
                    valid = false
                }
                if (!valid) return@setOnClickListener

                val phone = if (phoneDigits.isEmpty()) "" else
                    phoneDigits.substring(0, 4) + "-" + phoneDigits.substring(4)
                val patient = Patient(
                    id = existing?.id.orEmpty(), fullName = "$name $lastName",
                    record = existing?.record.orEmpty(),
                    status = existing?.status ?: PatientStatus.UNSPECIFIED,
                    age = birth?.let { Period.between(it, LocalDate.now()).years },
                    phone = phone, firstName = name, lastName = lastName,
                    birthDate = birth?.toString(), dui = dui, city = city
                )
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                dialog.getButton(AlertDialog.BUTTON_NEGATIVE).isEnabled = false
                dialog.setCancelable(false)
                AppContainer.ioExecutor.execute {
                    val result = runCatching {
                        if (existing == null) repository.add(patient)
                        else repository.update(patient)
                    }
                    runOnUiThread {
                        if (isDestroyed || isFinishing) return@runOnUiThread
                        result.fold(onSuccess = {
                            dialog.dismiss()
                            loadPatients()
                            showMessage(if (existing == null) R.string.patients_saved else R.string.patients_updated)
                            refreshPatients()
                        }, onFailure = { error ->
                            dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true
                            dialog.getButton(AlertDialog.BUTTON_NEGATIVE).isEnabled = true
                            dialog.setCancelable(true)
                            showMessage((error as? AuthException)?.messageRes ?: R.string.patient_save_error)
                        })
                    }
                }
            }
        }
        dialog.show()
    }

    // --------------------------------------------------------------- eliminar

    // ---------------------------------------------------------------- helpers

    private fun showMessage(messageRes: Int) {
        Snackbar.make(binding.root, messageRes, Snackbar.LENGTH_SHORT)
            .setAnchorView(binding.bottomNavContainer)
            .show()
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
