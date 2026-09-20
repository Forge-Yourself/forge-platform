package app.forge.restactivity

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/** Prototype `lock`: an ongoing countdown with +30s and Skip, and a loud "Rest done" at zero. */
object RestNotifier {
  const val CHANNEL_REST = "forge_rest"
  const val CHANNEL_DONE = "forge_rest_done"
  private const val ID_REST = 7301
  private const val ID_DONE = 7302
  const val ACTION_PLUS30 = "app.forge.restactivity.PLUS30"
  const val ACTION_SKIP = "app.forge.restactivity.SKIP"
  const val ACTION_ALARM = "app.forge.restactivity.ALARM"
  // Android 14+ no longer blocks swipe-dismiss on an ongoing notification, so the
  // delete intent gets its own action: RestActionReceiver treats it like Skip.
  const val ACTION_DISMISS = "app.forge.restactivity.DISMISS"

  private fun sound(c: Context): Uri = Uri.parse("android.resource://${c.packageName}/${R.raw.forge_timer_done}")

  /** Channel names are fixed at creation; they take the app's language at the first rest. */
  private fun ensureChannels(c: Context, s: RestState) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = c.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL_REST) == null) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_REST, s.channel, NotificationManager.IMPORTANCE_LOW).apply { setShowBadge(false) },
      )
    }
    if (nm.getNotificationChannel(CHANNEL_DONE) == null) {
      val attrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_DONE, s.channelDone, NotificationManager.IMPORTANCE_HIGH).apply {
          setSound(sound(c), attrs)
          enableVibration(true)
        },
      )
    }
  }

  private fun canPost(c: Context): Boolean =
    Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(c, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

  fun canExact(c: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

  private fun openApp(c: Context, s: RestState): PendingIntent {
    val intent = if (s.url.isNotEmpty()) {
      Intent(Intent.ACTION_VIEW, Uri.parse(s.url)).setPackage(c.packageName)
    } else {
      c.packageManager.getLaunchIntentForPackage(c.packageName) ?: Intent()
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(c, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private fun broadcast(c: Context, action: String, code: Int): PendingIntent {
    val target = if (action == ACTION_ALARM) RestAlarmReceiver::class.java else RestActionReceiver::class.java
    return PendingIntent.getBroadcast(
      c, code, Intent(c, target).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  @SuppressLint("MissingPermission") // canPost() is the check
  fun post(c: Context, s: RestState) {
    ensureChannels(c, s)
    val builder = NotificationCompat.Builder(c, CHANNEL_REST)
      .setSmallIcon(c.applicationInfo.icon)
      .setContentTitle(s.title)
      .setContentText(s.text)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      // The countdown is drawn by the system from `when`: exact even when the alarm is not.
      .setUsesChronometer(true)
      .setChronometerCountDown(true)
      .setShowWhen(true)
      .setWhen(s.endsAt)
      .setContentIntent(openApp(c, s))
      .setDeleteIntent(broadcast(c, ACTION_DISMISS, 4))
      .addAction(0, s.plus30, broadcast(c, ACTION_PLUS30, 1))
      .addAction(0, s.skip, broadcast(c, ACTION_SKIP, 2))
    // Android 16 Live Update. This is the extra NotificationCompat.setRequestPromotedOngoing
    // writes; set directly so it works whatever androidx.core the app resolves.
    builder.extras.putBoolean("android.requestPromotedOngoing", true)
    if (canPost(c)) NotificationManagerCompat.from(c).notify(ID_REST, builder.build())
  }

  @SuppressLint("MissingPermission") // canPost() is the check
  fun postDone(c: Context, s: RestState) {
    ensureChannels(c, s)
    NotificationManagerCompat.from(c).cancel(ID_REST)
    val done = NotificationCompat.Builder(c, CHANNEL_DONE)
      .setSmallIcon(c.applicationInfo.icon)
      .setContentTitle(s.doneTitle)
      .setContentText(s.doneBody)
      .setSound(sound(c)) // pre-O; O+ takes the channel's sound
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setAutoCancel(true)
      .setTimeoutAfter(5 * 60_000L)
      .setContentIntent(openApp(c, s))
      .build()
    if (canPost(c)) NotificationManagerCompat.from(c).notify(ID_DONE, done)
  }

  fun scheduleAlarm(c: Context, s: RestState) {
    val am = c.getSystemService(AlarmManager::class.java)
    val pi = broadcast(c, ACTION_ALARM, 3)
    if (canExact(c)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, s.endsAt, pi)
    else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, s.endsAt, pi)
  }

  fun cancel(c: Context) {
    NotificationManagerCompat.from(c).cancel(ID_REST)
    c.getSystemService(AlarmManager::class.java).cancel(broadcast(c, ACTION_ALARM, 3))
  }
}
