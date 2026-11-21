package sv.edu.catolica.hospital_universitario

import android.Manifest
import android.app.Activity
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Recordatorios locales del médico (espejo de scheduleReminders y DoctorBreakReminders de iOS):
 * aviso 15 minutos antes de cada cita sincronizada y, a petición, de almuerzo y descansos registrados.
 * Solo se programa con permiso de notificaciones; no guarda datos clínicos.
 */
object DoctorReminders {
    const val REQUEST = 4107
    private const val CHANNEL = "doctor_reminders"

    fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    fun requestPermission(activity: Activity): Boolean {
        if (allowed(activity)) return true
        if (Build.VERSION.SDK_INT >= 33) activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST)
        return false
    }
    fun scheduleAppointments(context: Context, upcoming: List<JSONObject>) {
        if (!allowed(context)) return
        upcoming.forEach { item ->
            val start = DoctorRules.local(item.value("starts_at")) ?: return@forEach
            val at = start.minusMinutes(15).toInstant().toEpochMilli()
            if (at <= System.currentTimeMillis() + 1000) return@forEach
            schedule(context, "appt." + item.value("id") + "." + item.value("starts_at"), at,
                context.getString(R.string.dx_rem_appt_title), context.getString(R.string.dx_rem_appt_body))
        }
    }
    fun scheduleBreaks(context: Context, week: DoctorWeek) {
        if (!allowed(context)) return
        week.days.forEach { day ->
            day.breaks.filter { it.kind != "gap" }.forEach { b ->
                val parts = b.start.split(":")
                val start = day.date.atTime(parts[0].toInt(), parts[1].toInt()).atZone(DoctorRules.zone).minusMinutes(5)
                val at = start.toInstant().toEpochMilli()
                if (at <= System.currentTimeMillis() + 1000) return@forEach
                val title = context.getString(if (b.kind == "lunch") R.string.dx_rem_lunch_title else R.string.dx_rem_break_title)
                schedule(context, "break.${day.date}.${b.start}", at, title, context.getString(R.string.dx_rem_break_body, b.start, b.end))
            }
        }
    }
    private fun schedule(context: Context, id: String, at: Long, title: String, body: String) {
        val intent = Intent(context, DoctorReminderReceiver::class.java).putExtra("title", title).putExtra("body", body).putExtra("id", id.hashCode())
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).set(AlarmManager.RTC_WAKEUP, at, pending)
    }
    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
            .createNotificationChannel(NotificationChannel(CHANNEL, context.getString(R.string.dx_rem_channel), NotificationManager.IMPORTANCE_DEFAULT))
    }
    fun notify(context: Context, id: Int, title: String, body: String) {
        if (!allowed(context)) return
        channel(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_d_bell_fill)
            .setContentTitle(title).setContentText(body).setColor(DoctorTheme.wine).setAutoCancel(true).setContentIntent(open).build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(id, notification)
    }
}

class DoctorReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        DoctorReminders.notify(context, intent.getIntExtra("id", 0), intent.getStringExtra("title").orEmpty(), intent.getStringExtra("body").orEmpty())
    }
}
