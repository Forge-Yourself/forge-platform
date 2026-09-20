package app.forge.restactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** +30s and Skip from the lock screen, handled here so they work with the app dead. */
class RestActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val s = RestStateStore.load(context) ?: return
    val now = System.currentTimeMillis()
    when (intent.action) {
      RestNotifier.ACTION_PLUS30 -> {
        // The same rule as plus30() in packages/shared/src/rest: from the later of target and now.
        val next = s.copy(endsAt = maxOf(s.endsAt, now) + 30_000L)
        RestStateStore.save(context, next)
        RestNotifier.post(context, next)
        RestNotifier.scheduleAlarm(context, next)
        RestStateStore.appendAction(context, s.sessionId, "plus30", now)
      }
      RestNotifier.ACTION_SKIP -> {
        RestStateStore.clear(context)
        RestNotifier.cancel(context)
        RestStateStore.appendAction(context, s.sessionId, "skip", now)
      }
      RestNotifier.ACTION_DISMISS -> {
        // The notification is already gone (that's how we got here), so +30s and
        // Skip are unreachable — stand the alarm down and end the rest like Skip,
        // queuing "skip" because that's the only action string JS parses.
        RestStateStore.clear(context)
        RestNotifier.cancel(context)
        RestStateStore.appendAction(context, s.sessionId, "skip", now)
      }
    }
  }
}
