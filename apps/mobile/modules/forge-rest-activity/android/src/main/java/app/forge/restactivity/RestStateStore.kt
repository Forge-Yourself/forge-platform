package app.forge.restactivity

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** The rest on the lock screen, and the copy to draw it with, in the app's language. */
data class RestState(
  val sessionId: String,
  val endsAt: Long,
  val title: String,
  val text: String,
  val plus30: String,
  val skip: String,
  val channel: String,
  val channelDone: String,
  val doneTitle: String,
  val doneBody: String,
  val url: String,
) {
  fun toJson(): String = JSONObject()
    .put("sessionId", sessionId).put("endsAt", endsAt).put("title", title).put("text", text)
    .put("plus30", plus30).put("skip", skip).put("channel", channel).put("channelDone", channelDone)
    .put("doneTitle", doneTitle).put("doneBody", doneBody).put("url", url)
    .toString()

  companion object {
    fun fromJson(json: String): RestState? = try {
      val o = JSONObject(json)
      RestState(
        o.getString("sessionId"), o.getLong("endsAt"), o.getString("title"), o.getString("text"),
        o.getString("plus30"), o.getString("skip"), o.getString("channel"), o.getString("channelDone"),
        o.getString("doneTitle"), o.getString("doneBody"), o.getString("url"),
      )
    } catch (e: Exception) {
      null
    }
  }
}

/**
 * SharedPreferences, because the receivers run with the JS runtime dead.
 * Taps are queued here and drained by JS on its next foreground (spec §6.2),
 * where applyNativeActions replays them at the time they happened.
 */
object RestStateStore {
  private const val PREFS = "forge_rest_activity"
  private const val KEY_STATE = "state"
  private const val KEY_ACTIONS = "actions"

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun load(c: Context): RestState? = prefs(c).getString(KEY_STATE, null)?.let { RestState.fromJson(it) }

  fun save(c: Context, s: RestState) {
    prefs(c).edit().putString(KEY_STATE, s.toJson()).commit()
  }

  fun clear(c: Context) {
    prefs(c).edit().remove(KEY_STATE).commit()
  }

  @Synchronized
  fun appendAction(c: Context, sessionId: String, action: String, at: Long) {
    val queue = JSONArray(prefs(c).getString(KEY_ACTIONS, "[]"))
    queue.put(JSONObject().put("sessionId", sessionId).put("action", action).put("at", at))
    prefs(c).edit().putString(KEY_ACTIONS, queue.toString()).commit()
  }

  @Synchronized
  fun drainActions(c: Context): List<Map<String, Any>> {
    val queue = JSONArray(prefs(c).getString(KEY_ACTIONS, "[]"))
    prefs(c).edit().putString(KEY_ACTIONS, "[]").commit()
    return (0 until queue.length()).map { i ->
      val o = queue.getJSONObject(i)
      mapOf("sessionId" to o.getString("sessionId"), "action" to o.getString("action"), "at" to o.getLong("at").toDouble())
    }
  }
}
