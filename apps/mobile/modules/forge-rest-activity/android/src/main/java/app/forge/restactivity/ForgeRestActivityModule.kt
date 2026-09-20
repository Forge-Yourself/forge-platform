package app.forge.restactivity

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class ShowPayload : Record {
  @Field val sessionId: String = ""
  @Field val endsAt: Double = 0.0
  @Field val title: String = ""
  @Field val text: String = ""
  @Field val url: String = ""
  @Field val plus30: String = "+30s"
  @Field val skip: String = "Skip"
  @Field val channel: String = "Rest timer"
  @Field val channelDone: String = "Rest done"
  @Field val doneTitle: String = "Rest done"
  @Field val doneBody: String = ""
}

class ForgeRestActivityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("ForgeRestActivity")

    AsyncFunction("show") { p: ShowPayload ->
      val s = RestState(
        p.sessionId, p.endsAt.toLong(), p.title, p.text, p.plus30, p.skip,
        p.channel, p.channelDone, p.doneTitle, p.doneBody, p.url,
      )
      RestStateStore.save(context, s)
      RestNotifier.post(context, s)
      RestNotifier.scheduleAlarm(context, s)
    }

    AsyncFunction("end") {
      RestStateStore.clear(context)
      RestNotifier.cancel(context)
    }

    AsyncFunction("drainActions") {
      RestStateStore.drainActions(context)
    }

    AsyncFunction("status") {
      when {
        !NotificationManagerCompat.from(context).areNotificationsEnabled() -> "notifications_off"
        !RestNotifier.canExact(context) -> "inexact"
        else -> "ok"
      }
    }

    Function("openExactAlarmSettings") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        context.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
            .setData(Uri.parse("package:" + context.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
      }
    }
  }
}
