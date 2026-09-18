-- Keep credential activation and session revocation in one SQLite statement, including operator recovery.
CREATE TRIGGER auth_rotation_revokes_sessions
AFTER UPDATE OF active_credential_id, session_generation ON auth_state
WHEN OLD.active_credential_id != NEW.active_credential_id OR OLD.session_generation != NEW.session_generation
BEGIN
  DELETE FROM admin_sessions;
END;
