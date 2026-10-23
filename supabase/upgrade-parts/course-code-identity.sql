-- Source component for scripts/build-schema.mjs. Apply the generated
-- supabase/upgrades/20261022-course-code-identity.sql to initialized databases;
-- it wraps this DDL and the current import RPC in a single transaction.
-- Formal course codes become the identity when present; only uncoded rows
-- are constrained by (name, college).

DO $$
DECLARE
  duplicate_count INTEGER;
  bad_code_count INTEGER;
BEGIN
  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT name, college_id
    FROM public.courses
    WHERE code IS NULL
    GROUP BY name, college_id
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION '无法升级：存在 % 组同名同学院的无编码课程，请先人工核对', duplicate_count;
  END IF;

  SELECT count(*) INTO bad_code_count
  FROM public.courses
  WHERE code IS NOT NULL AND (char_length(code) < 1 OR char_length(code) > 80);
  IF bad_code_count > 0 THEN
    RAISE EXCEPTION '无法升级：存在 % 条长度非法的课程编码', bad_code_count;
  END IF;
END $$;

ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_name_college_id_key;
DROP INDEX IF EXISTS public.courses_name_college_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS courses_uncoded_name_college_idx
  ON public.courses (name, college_id) WHERE code IS NULL;
CREATE INDEX IF NOT EXISTS courses_name_college_idx
  ON public.courses (name, college_id);

ALTER TABLE public.courses DROP CONSTRAINT IF EXISTS courses_code_length_check;
ALTER TABLE public.courses
  ADD CONSTRAINT courses_code_length_check
  CHECK (code IS NULL OR char_length(code) BETWEEN 1 AND 80) NOT VALID;
ALTER TABLE public.courses VALIDATE CONSTRAINT courses_code_length_check;
