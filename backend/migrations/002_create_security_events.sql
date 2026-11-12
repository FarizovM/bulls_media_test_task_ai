CREATE TABLE IF NOT EXISTS security_events (
  event_id uuid PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type = 'PROMPT_INJECTION_DETECTED'),
  request_id varchar(100) NOT NULL,
  actor_subject varchar(255) NOT NULL,
  detection_code varchar(100) NOT NULL,
  input_length smallint NOT NULL CHECK (input_length BETWEEN 0 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_created_at_idx
  ON security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS security_events_actor_created_at_idx
  ON security_events (actor_subject, created_at DESC);
