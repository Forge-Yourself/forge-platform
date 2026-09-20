package app.forge.restactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Zero. A +30s after this alarm was set moved the target and scheduled its own alarm; this one stands down. */
class RestAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val s = RestStateStore.load(context) ?: return
    if (s.endsAt - System.currentTimeMillis() > 1_000L) return
    RestNotifier.postDone(context, s)
    RestStateStore.clear(context)
  }
}
