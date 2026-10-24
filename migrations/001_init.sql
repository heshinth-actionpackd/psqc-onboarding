-- Students collected during cohort onboarding, plus the step they are on.
-- phone is the sender number (WhatsApp) once we have it. channel_user_id is the
-- stable id on that channel (WhatsApp: the sender digits).

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  college TEXT,
  course TEXT CHECK (course IS NULL OR course IN ('fundamental', 'advanced')),
  batch TEXT,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp')),
  channel_user_id TEXT NOT NULL,
  current_step TEXT NOT NULL CHECK (current_step IN (
    'new',
    'awaiting_name',
    'awaiting_email',
    'awaiting_college',
    'awaiting_course',
    'awaiting_batch',
    'completed'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, channel_user_id)
);

CREATE INDEX students_phone_idx ON students (phone);

CREATE TRIGGER students_set_updated_at
BEFORE UPDATE ON students
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- Session details sent after a student confirms a course + batch.
-- Replace the placeholder rows before going live.
CREATE TABLE course_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course TEXT NOT NULL CHECK (course IN ('fundamental', 'advanced')),
  batch TEXT NOT NULL,
  session_details TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course, batch)
);

CREATE TRIGGER course_batches_set_updated_at
BEFORE UPDATE ON course_batches
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

INSERT INTO course_batches (course, batch, session_details) VALUES
  (
    'fundamental',
    'upcoming',
    'Placeholder session details for the Fundamental course. Replace this row with the real batch name, schedule, and join link.'
  ),
  (
    'advanced',
    'upcoming',
    'Placeholder session details for the Advanced course. Replace this row with the real batch name, schedule, and join link.'
  )
ON CONFLICT (course, batch) DO NOTHING;

-- Inbound Actionpackd event ids. status stays 'processing' until replies are
-- sent, so a webhook retry cannot advance the student twice and can resend.
CREATE TABLE processed_events (
  event_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed')),
  replies JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);
