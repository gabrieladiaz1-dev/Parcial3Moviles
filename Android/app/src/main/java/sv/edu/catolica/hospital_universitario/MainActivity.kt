package sv.edu.catolica.hospital_universitario

import android.os.Bundle
import android.text.method.HideReturnsTransformationMethod
import android.text.method.PasswordTransformationMethod
import android.util.Patterns
import android.widget.Toast
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.launch
import sv.edu.catolica.hospital_universitario.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var isPasswordVisible = false
    private val viewModel: LoginViewModel by viewModels()
    private var roleDialogShown = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupListeners()
        observeState()
        binding.btnNursingRole.visibility = android.view.View.GONE
        binding.btnDoctorRole.visibility = android.view.View.GONE
    }

    /** Observa el estado del ViewModel y pinta la pantalla (MVVM). */
    private fun observeState() {
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                viewModel.state.collect { state ->
                    setBusy(state is LoginState.Loading)
                    when (state) {
                        is LoginState.Authenticated -> if (!roleDialogShown) chooseRole(state.session)
                        is LoginState.Failed -> {
                            Toast.makeText(this@MainActivity, state.messageRes, Toast.LENGTH_LONG).show()
                            viewModel.consumed()
                        }
                        else -> Unit
                    }
                }
            }
        }
    }

    private fun chooseRole(session: AuthSession) {
        val roles = session.roles.toList()
        if (roles.size == 1) {
            enter(session, roles.single())
            return
        }
        roleDialogShown = true
        com.google.android.material.dialog.MaterialAlertDialogBuilder(this)
            .setTitle(R.string.auth_choose_role)
            .setItems(roles.map { getString(when (it) {
                SessionManager.Role.RECEPTION -> R.string.auth_role_reception
                SessionManager.Role.NURSING -> R.string.auth_role_nursing
                SessionManager.Role.DOCTOR -> R.string.auth_role_doctor
            }) }.toTypedArray()) { _, which -> enter(session, roles[which]) }
            .setOnCancelListener { roleDialogShown = false; viewModel.discard(session) }
            .show()
    }

    private fun enter(session: AuthSession, role: SessionManager.Role) {
        roleDialogShown = false
        viewModel.consumed()
        SessionManager.start(session, role)
        Navigator.goToHomeForRole(this, role, closeCurrent = true)
    }

    private fun setBusy(busy: Boolean) {
        binding.btnLogin.isEnabled = !busy
        binding.btnNursingRole.isEnabled = !busy
        binding.btnDoctorRole.isEnabled = !busy
    }

    private fun setupListeners() {
        // Toggle password visibility
        binding.ivPasswordToggle.setOnClickListener {
            isPasswordVisible = !isPasswordVisible
            if (isPasswordVisible) {
                binding.etPassword.transformationMethod = HideReturnsTransformationMethod.getInstance()
                binding.ivPasswordToggle.setImageResource(android.R.drawable.ic_menu_close_clear_cancel)
            } else {
                binding.etPassword.transformationMethod = PasswordTransformationMethod.getInstance()
                binding.ivPasswordToggle.setImageResource(android.R.drawable.ic_menu_view)
            }
            // Move cursor to the end of text
            binding.etPassword.setSelection(binding.etPassword.text.length)
        }

        // Login button click
        binding.btnLogin.setOnClickListener {
            val email = binding.etEmail.text.toString().trim()
            val password = binding.etPassword.text.toString()

            if (email.isEmpty()) {
                binding.etEmail.error = getString(R.string.error_email_required)
                binding.etEmail.requestFocus()
                return@setOnClickListener
            }

            if (!Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
                binding.etEmail.error = getString(R.string.error_email_invalid)
                binding.etEmail.requestFocus()
                return@setOnClickListener
            }

            if (password.isEmpty()) {
                binding.etPassword.error = getString(R.string.error_password_required)
                binding.etPassword.requestFocus()
                return@setOnClickListener
            }

            viewModel.signIn(email, password)
        }

        // Forgot password click
        binding.tvForgotPassword.setOnClickListener {
            Toast.makeText(this, R.string.msg_forgot_password, Toast.LENGTH_SHORT).show()
        }
    }
}
