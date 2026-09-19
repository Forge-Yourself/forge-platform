-- =============================================================================
-- 0018 · M4d floor ergonomics: Realtime Presence on session topics.
--
-- The console rail shows "Live mirror · N connected" (spec D10). That count is
-- Presence on the same private topic session:<uuid> that 0016 opened for
-- broadcast. Realtime authorizes a presence track as an INSERT and a presence
-- read as a SELECT on realtime.messages with extension = 'presence'.
--
-- Participants only, deliberately no is_admin(): an admin reading the session
-- inspector must never appear as a device on the client's mirror. Broadcast is
-- untouched: still SELECT-only, still nobody broadcasts.
-- =============================================================================

BEGIN;

CREATE POLICY forge_session_presence_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension = 'presence'
    AND realtime.topic() ~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_session_participant(substring(realtime.topic() FROM 9)::UUID)
  );

CREATE POLICY forge_session_presence_track ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension = 'presence'
    AND realtime.topic() ~ '^session:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND public.is_session_participant(substring(realtime.topic() FROM 9)::UUID)
  );

COMMIT;
