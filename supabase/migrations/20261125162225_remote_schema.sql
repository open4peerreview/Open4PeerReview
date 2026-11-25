SET local check_function_bodies = off;

CREATE TABLE "public"."ai_chat_events" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     uuid                     NOT NULL,
  "document_id" uuid,
  "session_id"  uuid                     NOT NULL,
  "page_role"   text,
  "page_path"   text,
  "event_type"  text                     NOT NULL,
  "event_data"  jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_chat_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ai_chat_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ai_chat_messages" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "session_id"    uuid                     NOT NULL,
  "role"          text                     NOT NULL,
  "content"       text                     NOT NULL,
  "shortcut_type" text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY (id),
  CONSTRAINT "ai_chat_messages_role_check" CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

ALTER TABLE "public"."ai_chat_messages"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."ai_chat_sessions" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid                     NOT NULL,
  "review_id"   uuid,
  "user_id"     uuid                     NOT NULL,
  "role"        text                     NOT NULL,
  "rubric_name" text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_chat_sessions_pkey" PRIMARY KEY (id),
  CONSTRAINT "ai_chat_sessions_role_check" CHECK ((role = ANY (ARRAY['reviewer'::text, 'author'::text])))
);

ALTER TABLE "public"."ai_chat_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."annotations" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "anchor"         jsonb                    NOT NULL,
  "body"           text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  "tag"            text,
  "review_id"      uuid                     NOT NULL,
  "rubric_item_id" uuid,
  CONSTRAINT "annotations_body_check" CHECK ((TRIM(BOTH FROM body) <> ''::text)),
  CONSTRAINT "annotations_pkey" PRIMARY KEY (id),
  CONSTRAINT "annotations_tag_check" CHECK ((tag = ANY (ARRAY['general'::text, 'action_item'::text, 'quick_fix'::text])))
);

ALTER TABLE "public"."annotations"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."author_feedback_comments" (
  "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL,
  "review_id"   uuid NOT NULL,
  CONSTRAINT "author_feedback_comments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."author_feedback_comments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."author_feedback_responses" (
  "id"          uuid NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid NOT NULL,
  "review_id"   uuid NOT NULL,
  CONSTRAINT "author_feedback_responses_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."author_feedback_responses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."document_acceptances" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid                     NOT NULL,
  "reviewer_id" uuid                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_acceptances_document_id_reviewer_id_key" UNIQUE (document_id, reviewer_id),
  CONSTRAINT "document_acceptances_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."document_acceptances"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."document_assignments" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id"  uuid                     NOT NULL,
  "reviewer_id"  uuid                     NOT NULL,
  "assigned_by"  uuid                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "decline_note" text,
  "declined_at"  timestamp with time zone,
  CONSTRAINT "document_assignments_document_id_reviewer_id_key" UNIQUE (document_id, reviewer_id),
  CONSTRAINT "document_assignments_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."document_assignments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."document_rubrics" (
  "document_id" uuid                     NOT NULL,
  "rubric_id"   uuid                     NOT NULL,
  "assigned_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "document_rubrics_pkey" PRIMARY KEY (document_id, rubric_id)
);

ALTER TABLE "public"."document_rubrics"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."documents" (
  "id"           uuid NOT NULL DEFAULT gen_random_uuid(),
  "author_id"    uuid NOT NULL,
  "title"        text NOT NULL,
  "file_url"     text,
  "storage_path" text,
  CONSTRAINT "documents_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."documents"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."institutions" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "institutions_name_key" UNIQUE (name),
  CONSTRAINT "institutions_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."institutions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."review_declines" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid                     NOT NULL,
  "reviewer_id" uuid                     NOT NULL,
  "note"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "review_declines_document_id_reviewer_id_key" UNIQUE (document_id, reviewer_id),
  CONSTRAINT "review_declines_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."review_declines"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."review_events" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "review_id"   uuid                     NOT NULL,
  "reviewer_id" uuid                     NOT NULL,
  "session_id"  uuid                     NOT NULL,
  "event_type"  text                     NOT NULL,
  "data"        jsonb,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "review_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."review_events"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."review_rubric_submissions" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "review_id"    uuid                     NOT NULL,
  "rubric_id"    uuid                     NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "review_rubric_submissions_pkey" PRIMARY KEY (id),
  CONSTRAINT "review_rubric_submissions_review_id_rubric_id_key" UNIQUE (review_id, rubric_id)
);

ALTER TABLE "public"."review_rubric_submissions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."review_scores" (
  "id"             uuid NOT NULL DEFAULT gen_random_uuid(),
  "review_id"      uuid NOT NULL,
  "rubric_item_id" uuid NOT NULL,
  CONSTRAINT "review_scores_pkey" PRIMARY KEY (id),
  CONSTRAINT "uq_review_score" UNIQUE (review_id, rubric_item_id)
);

ALTER TABLE "public"."review_scores"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."reviews" (
  "id"              uuid NOT NULL DEFAULT gen_random_uuid(),
  "document_id"     uuid NOT NULL,
  "rubric_id"       uuid NOT NULL,
  "reviewer_id"     uuid NOT NULL,
  "overall_comment" text,
  CONSTRAINT "reviews_pkey" PRIMARY KEY (id),
  CONSTRAINT "uq_review" UNIQUE (document_id, rubric_id, reviewer_id)
);

ALTER TABLE "public"."reviews"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."revision_notes" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "document_id" uuid                     NOT NULL,
  "author_id"   uuid                     NOT NULL,
  "review_id"   uuid,
  "body"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "revision_notes_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."revision_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."rubric_items" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "rubric_id"   uuid                     NOT NULL,
  "label"       text                     NOT NULL,
  "description" text,
  "sort_order"  integer                  NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rubric_items_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."rubric_items"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."rubrics" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "title"                  text                     NOT NULL,
  "description"            text,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "is_preset"              boolean                  NOT NULL DEFAULT false,
  "operational_definition" text,
  CONSTRAINT "rubrics_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."rubrics"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."score_comments" (
  "id"             uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "review_id"      uuid                     NOT NULL,
  "rubric_item_id" uuid                     NOT NULL,
  "score_level"    text                     NOT NULL,
  "body"           text                     NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "score_comments_body_check" CHECK ((TRIM(BOTH FROM body) <> ''::text)),
  CONSTRAINT "score_comments_pkey" PRIMARY KEY (id),
  CONSTRAINT "score_comments_score_level_check" CHECK ((score_level = ANY (ARRAY['does_not_meet'::text, 'exceeds'::text, 'exemplifies'::text])))
);

ALTER TABLE "public"."score_comments"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."users" (
  "id"                     uuid                     NOT NULL,
  "email"                  text                     NOT NULL,
  "display_name"           text,
  "created_at"             timestamp with time zone NOT NULL DEFAULT now(),
  "profession"             text,
  "primary_discipline"     text,
  "institution"            text,
  "roles"                  text[]                   NOT NULL DEFAULT '{}'::text[],
  "onboarding_completed"   boolean                  NOT NULL DEFAULT false,
  "reviewer_type"          text,
  "expertise_tags"         text[]                   DEFAULT '{}'::text[],
  "rubric_specializations" text[]                   DEFAULT '{}'::text[],
  CONSTRAINT "users_email_key" UNIQUE (email),
  CONSTRAINT "users_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."users"
  ENABLE ROW LEVEL SECURITY;

CREATE TYPE "public"."anchor_type" AS ENUM (
  'text-range',
  'dom-range',
  'bbox',
  'timestamp'
);

CREATE TYPE "public"."creative_commons_license" AS ENUM (
  'cc_by',
  'cc_by_sa',
  'cc_by_nd',
  'cc_by_nc',
  'cc_by_nc_sa',
  'cc_by_nc_nd'
);

CREATE TYPE "public"."criterion_score" AS ENUM (
  'does_not_meet',
  'exemplifies',
  'exceeds'
);

ALTER TABLE "public"."review_scores"
  ADD COLUMN "score" public.criterion_score;

ALTER TABLE "public"."review_scores"
  ADD COLUMN "comment" text;

ALTER TABLE "public"."review_scores"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."review_scores"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."review_scores"
  ADD COLUMN "criterion_scores" public.criterion_score[] NOT NULL DEFAULT '{}'::public.criterion_score[];

ALTER TABLE "public"."review_scores"
  ADD COLUMN "document_id" uuid;

CREATE TYPE "public"."expert_domain" AS ENUM (
  'agriculture',
  'arts_and_humanities',
  'biology',
  'business',
  'chemistry',
  'computer_science',
  'economics',
  'education',
  'engineering',
  'environmental_science',
  'health_and_medicine',
  'history',
  'law',
  'mathematics',
  'physics',
  'social_sciences',
  'other'
);

CREATE TYPE "public"."feedback_response_status" AS ENUM (
  'addressed',
  'will_address_later',
  'will_not_address'
);

CREATE TYPE "public"."feedback_target_type" AS ENUM (
  'annotation',
  'score_comment',
  'general_comment',
  'overall_comment',
  'criterion'
);

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "target_type" public.feedback_target_type NOT NULL;

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "target_id" uuid NOT NULL;

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "body" text NOT NULL;

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "author_id" uuid NOT NULL;

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."author_feedback_comments"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "target_type" public.feedback_target_type NOT NULL;

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "target_id" uuid NOT NULL;

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "status" public.feedback_response_status NOT NULL;

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "author_id" uuid NOT NULL;

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."author_feedback_responses"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

CREATE TYPE "public"."file_type" AS ENUM (
  'pdf',
  'html',
  'image',
  'audio',
  'pptx'
);

ALTER TABLE "public"."documents"
  ADD COLUMN "file_type" public.file_type;

ALTER TABLE "public"."documents"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."documents"
  ADD COLUMN "authors" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."documents"
  ADD COLUMN "subject_matter" text NOT NULL DEFAULT ''::text;

ALTER TABLE "public"."documents"
  ADD COLUMN "creative_commons_license" public.creative_commons_license NOT NULL DEFAULT 'cc_by'::public.creative_commons_license;

ALTER TABLE "public"."documents"
  ADD COLUMN "third_party_content_disclosure" text;

ALTER TABLE "public"."documents"
  ADD COLUMN "source_url" text;

ALTER TABLE "public"."documents"
  ADD COLUMN "content_fingerprint" text;

ALTER TABLE "public"."documents"
  ADD COLUMN "platform" text;

ALTER TABLE "public"."documents"
  ADD COLUMN "submission_scope" text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE "public"."documents"
  ADD COLUMN "coordinator_released_at" timestamp WITH time zone;

ALTER TABLE "public"."documents"
  ADD COLUMN "is_draft" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."documents"
  ADD COLUMN "coordinator_upload" boolean NOT NULL DEFAULT false;

ALTER TABLE "public"."documents"
  ADD COLUMN "pages" jsonb;

ALTER TABLE "public"."documents"
  ADD COLUMN "course_access_code" text;

ALTER TABLE "public"."documents"
  ADD COLUMN "public_review" boolean;

CREATE TYPE "public"."report_status" AS ENUM (
  'revising',
  'published',
  'private'
);

ALTER TABLE "public"."documents"
  ADD COLUMN "report_status" public.report_status;

ALTER TABLE "public"."documents"
  ADD COLUMN "revised_link" text;

CREATE TYPE "public"."review_status" AS ENUM (
  'in_progress',
  'submitted',
  'unassigned',
  'assigned'
);

ALTER TABLE "public"."reviews"
  ADD COLUMN "status" public.review_status NOT NULL DEFAULT 'in_progress'::public.review_status;

ALTER TABLE "public"."reviews"
  ADD COLUMN "created_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."reviews"
  ADD COLUMN "updated_at" timestamp WITH time zone NOT NULL DEFAULT now();

ALTER TABLE "public"."reviews"
  ADD COLUMN "submitted_at" timestamp WITH time zone;

ALTER TABLE "public"."reviews"
  ADD COLUMN "last_saved_at" timestamp WITH time zone;

ALTER TABLE "public"."reviews"
  ADD COLUMN "general_comment" text;

ALTER TABLE "public"."reviews"
  ADD COLUMN "reviewer_notes" text;

ALTER TABLE "public"."reviews"
  ADD COLUMN "notes" text;

ALTER TABLE "public"."reviews"
  ADD COLUMN "coordinator_approval" text;

ALTER TABLE "public"."reviews"
  ADD COLUMN "coordinator_note" text;

ALTER TABLE "public"."reviews"
  ADD COLUMN "coordinator_decided_at" timestamp WITH time zone;

CREATE TYPE "public"."user_role" AS ENUM (
  'reviewer',
  'author',
  'admin'
);

ALTER TABLE "public"."users"
  ADD COLUMN "role" public.user_role DEFAULT 'reviewer'::public.user_role;

CREATE OR REPLACE FUNCTION public.auto_decline_other_assignments()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  WITH declined AS (
    UPDATE document_assignments
    SET declined_at = now(),
        decline_note = 'Automatically declined — another reviewer accepted this document'
    WHERE document_id = NEW.document_id
      AND reviewer_id != NEW.reviewer_id
      AND declined_at IS NULL
    RETURNING reviewer_id
  )
  INSERT INTO review_declines (document_id, reviewer_id, note)
  SELECT NEW.document_id, declined.reviewer_id,
         'Automatically declined — another reviewer accepted this document'
  FROM declined;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_user_role()
  RETURNS public.user_role
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  AS $function$
  SELECT role FROM public.users WHERE id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.enforce_all_criteria_scored()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
DECLARE
  total_criteria   INT;
  scored_criteria  INT;
  missing_labels   TEXT;
BEGIN
  -- Only run when transitioning to 'submitted'
  IF NEW.status <> 'submitted' OR OLD.status = 'submitted' THEN
    RETURN NEW;
  END IF;

  -- Count how many criteria this rubric has
  SELECT COUNT(*) INTO total_criteria
  FROM public.rubric_items
  WHERE rubric_id = NEW.rubric_id;

  -- Count how many have been scored in this review
  SELECT COUNT(*) INTO scored_criteria
  FROM public.review_scores
  WHERE review_id = NEW.id;

  IF scored_criteria < total_criteria THEN
    -- Collect the labels of unscored criteria for a helpful error message
    SELECT string_agg(ri.label, ', ' ORDER BY ri.sort_order)
    INTO missing_labels
    FROM public.rubric_items ri
    WHERE ri.rubric_id = NEW.rubric_id
      AND NOT EXISTS (
        SELECT 1 FROM public.review_scores rs
        WHERE rs.review_id = NEW.id
          AND rs.rubric_item_id = ri.id
      );

    RAISE EXCEPTION
      'Cannot submit: % of % criteria are unscored. Missing: %',
      (total_criteria - scored_criteria), total_criteria, missing_labels;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.guard_preset_rubrics()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF OLD.is_preset = TRUE AND NEW.is_preset = FALSE THEN
    RAISE EXCEPTION 'Cannot remove preset status from a preset rubric.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_org_coordinator_for_document (
  p_document_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from documents d
    join users author on author.id = d.author_id
    join users coord  on coord.id  = auth.uid()
    where d.id = p_document_id
      and coord.roles @> array['coordinator']::text[]
      and coord.institution is not null
      and coord.institution = author.institution
  );
$function$;

CREATE OR REPLACE FUNCTION public.lock_submitted_annotations()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reviews r
    WHERE r.id = OLD.review_id AND r.status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'Cannot modify annotations on a submitted review.';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lock_submitted_review_scores()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.reviews
    WHERE id = OLD.review_id AND status = 'submitted'
  ) THEN
    RAISE EXCEPTION 'Cannot modify scores on a submitted review.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.review_approved_for_author (
  p_review_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1
    from reviews r
    join documents d on d.id = r.document_id
    where r.id = p_review_id
      and (
        not (coalesce(d.submission_scope, '{}'::text[]) @> array['organization']::text[])
        or r.coordinator_approval = 'approved'
      )
  );
$function$;

CREATE OR REPLACE FUNCTION public.review_has_submission (
  p_review_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.review_rubric_submissions where review_id = p_review_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rubric_submitted_for_review (
  p_review_id uuid,
  p_rubric_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
  select exists (
    select 1 from public.review_rubric_submissions
    where review_id = p_review_id and rubric_id = p_rubric_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.set_review_score_document_id()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  -- Only derive when not explicitly provided; keep any caller-supplied value.
  IF NEW.document_id IS NULL THEN
    SELECT r.document_id INTO NEW.document_id
    FROM public.reviews r
    WHERE r.id = NEW.review_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_submitted_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status <> 'submitted' THEN
    NEW.submitted_at = now();
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.touch_review_last_saved()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  UPDATE public.reviews
  SET last_saved_at = now()
  WHERE id = NEW.review_id;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_torus_document_pages (
  p_document_id  uuid,
  p_storage_path text,
  p_page_entry   jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
BEGIN
  -- Verify the caller has an active review for this document
  IF NOT EXISTS (
    SELECT 1 FROM reviews
    WHERE document_id = p_document_id
      AND reviewer_id = auth.uid()
      AND status IN ('assigned', 'in_progress')
  ) THEN
    RAISE EXCEPTION 'Access denied: no active review for this document';
  END IF;

  -- Initialize storage_path if not yet set, then upsert the page entry by URL
  UPDATE documents
  SET
    storage_path = COALESCE(storage_path, p_storage_path),
    pages = (
      -- Remove existing entry for this URL (if any), then append updated entry
      COALESCE(
        (SELECT jsonb_agg(p)
         FROM jsonb_array_elements(COALESCE(pages, '[]'::jsonb)) AS p
         WHERE p->>'url' != (p_page_entry->>'url')),
        '[]'::jsonb
      ) || jsonb_build_array(p_page_entry)
    )
  WHERE id = p_document_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."ai_chat_events"
  ADD CONSTRAINT "ai_chat_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_chat_messages"
  ADD CONSTRAINT "ai_chat_messages_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.ai_chat_sessions(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_chat_sessions"
  ADD CONSTRAINT "ai_chat_sessions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_comments"
  ADD CONSTRAINT "author_feedback_comments_target_type_target_id_key" UNIQUE (target_type, target_id);

ALTER TABLE "public"."author_feedback_responses"
  ADD CONSTRAINT "author_feedback_responses_target_type_target_id_key" UNIQUE (target_type, target_id);

ALTER TABLE "public"."ai_chat_events"
  ADD CONSTRAINT "ai_chat_events_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE SET NULL;

ALTER TABLE "public"."ai_chat_sessions"
  ADD CONSTRAINT "ai_chat_sessions_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_comments"
  ADD CONSTRAINT "author_feedback_comments_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_responses"
  ADD CONSTRAINT "author_feedback_responses_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_acceptances"
  ADD CONSTRAINT "document_acceptances_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_assignments"
  ADD CONSTRAINT "document_assignments_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_rubrics"
  ADD CONSTRAINT "document_rubrics_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_declines"
  ADD CONSTRAINT "review_declines_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_events"
  ADD CONSTRAINT "review_events_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES auth.users(id);

ALTER TABLE "public"."review_scores"
  ADD CONSTRAINT "review_scores_comment_check" CHECK (((comment IS NULL) OR (TRIM(BOTH FROM comment) <> ''::text)));

ALTER TABLE "public"."review_scores"
  ADD CONSTRAINT "review_scores_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_coordinator_approval_check"
    CHECK (((coordinator_approval IS NULL) OR (coordinator_approval = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text]))));

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."ai_chat_sessions"
  ADD CONSTRAINT "ai_chat_sessions_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE SET NULL;

ALTER TABLE "public"."annotations"
  ADD CONSTRAINT "annotations_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_comments"
  ADD CONSTRAINT "author_feedback_comments_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_responses"
  ADD CONSTRAINT "author_feedback_responses_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_events"
  ADD CONSTRAINT "review_events_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_rubric_submissions"
  ADD CONSTRAINT "review_rubric_submissions_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_scores"
  ADD CONSTRAINT "review_scores_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."revision_notes"
  ADD CONSTRAINT "revision_notes_document_id_fkey" FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;

ALTER TABLE "public"."revision_notes"
  ADD CONSTRAINT "revision_notes_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."annotations"
  ADD CONSTRAINT "annotations_rubric_item_id_fkey" FOREIGN KEY (rubric_item_id) REFERENCES public.rubric_items(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_scores"
  ADD CONSTRAINT "review_scores_rubric_item_id_fkey" FOREIGN KEY (rubric_item_id) REFERENCES public.rubric_items(id) ON DELETE RESTRICT;

ALTER TABLE "public"."document_rubrics"
  ADD CONSTRAINT "document_rubrics_rubric_id_fkey" FOREIGN KEY (rubric_id) REFERENCES public.rubrics(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_rubric_submissions"
  ADD CONSTRAINT "review_rubric_submissions_rubric_id_fkey" FOREIGN KEY (rubric_id) REFERENCES public.rubrics(id) ON DELETE CASCADE;

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_rubric_id_fkey" FOREIGN KEY (rubric_id) REFERENCES public.rubrics(id) ON DELETE RESTRICT;

ALTER TABLE "public"."rubric_items"
  ADD CONSTRAINT "rubric_items_rubric_id_fkey" FOREIGN KEY (rubric_id) REFERENCES public.rubrics(id) ON DELETE CASCADE;

ALTER TABLE "public"."score_comments"
  ADD CONSTRAINT "score_comments_review_id_fkey" FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;

ALTER TABLE "public"."score_comments"
  ADD CONSTRAINT "score_comments_rubric_item_id_fkey" FOREIGN KEY (rubric_item_id) REFERENCES public.rubric_items(id) ON DELETE CASCADE;

ALTER TABLE "public"."users"
  ADD CONSTRAINT "users_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_comments"
  ADD CONSTRAINT "author_feedback_comments_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."author_feedback_responses"
  ADD CONSTRAINT "author_feedback_responses_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_acceptances"
  ADD CONSTRAINT "document_acceptances_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."document_assignments"
  ADD CONSTRAINT "document_assignments_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES public.users(id);

ALTER TABLE "public"."document_assignments"
  ADD CONSTRAINT "document_assignments_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."documents"
  ADD CONSTRAINT "documents_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."review_declines"
  ADD CONSTRAINT "review_declines_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."reviews"
  ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."revision_notes"
  ADD CONSTRAINT "revision_notes_author_id_fkey" FOREIGN KEY (author_id) REFERENCES public.users(id) ON DELETE CASCADE;

CREATE INDEX ai_chat_events_created_at_idx ON public.ai_chat_events USING btree (created_at DESC);

CREATE INDEX ai_chat_events_event_type_idx ON public.ai_chat_events USING btree (event_type);

CREATE INDEX ai_chat_events_user_session_idx ON public.ai_chat_events USING btree (user_id, session_id, created_at);

CREATE INDEX ai_chat_messages_session_idx ON public.ai_chat_messages USING btree (session_id, created_at);

CREATE INDEX ai_chat_sessions_document_user_idx ON public.ai_chat_sessions USING btree (document_id, user_id, updated_at DESC);

CREATE INDEX author_feedback_responses_document_id_idx ON public.author_feedback_responses USING btree (document_id);

CREATE INDEX author_feedback_responses_review_id_idx ON public.author_feedback_responses USING btree (review_id);

CREATE INDEX idx_document_rubrics_document_id ON public.document_rubrics USING btree (document_id);

CREATE INDEX idx_document_rubrics_rubric_id ON public.document_rubrics USING btree (rubric_id);

CREATE INDEX idx_documents_author_id ON public.documents USING btree (author_id);

CREATE INDEX idx_review_rubric_submissions_review ON public.review_rubric_submissions USING btree (review_id);

CREATE INDEX idx_review_scores_document_id ON public.review_scores USING btree (document_id);

CREATE INDEX idx_review_scores_review ON public.review_scores USING btree (review_id);

CREATE INDEX idx_reviews_document ON public.reviews USING btree (document_id);

CREATE INDEX idx_reviews_reviewer ON public.reviews USING btree (reviewer_id);

CREATE INDEX idx_reviews_rubric ON public.reviews USING btree (rubric_id);

CREATE INDEX idx_rubric_items_rubric_id ON public.rubric_items USING btree (rubric_id);

CREATE INDEX review_events_review_id_occurred_at_idx ON public.review_events USING btree (review_id, occurred_at);

CREATE INDEX review_events_reviewer_id_event_type_idx ON public.review_events USING btree (reviewer_id, event_type);

CREATE INDEX revision_notes_document_id_idx ON public.revision_notes USING btree (document_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_annotations_updated_at
  BEFORE UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_lock_submitted_annotations
  BEFORE DELETE OR UPDATE ON public.annotations
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_submitted_annotations();

CREATE TRIGGER trg_auto_decline_other_assignments
  AFTER INSERT ON public.document_acceptances
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_decline_other_assignments();

CREATE TRIGGER trg_lock_submitted_scores
  BEFORE DELETE OR UPDATE ON public.review_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.lock_submitted_review_scores();

CREATE TRIGGER trg_review_scores_updated_at
  BEFORE UPDATE ON public.review_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_set_review_score_document_id
  BEFORE INSERT ON public.review_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.set_review_score_document_id();

CREATE TRIGGER trg_touch_review_last_saved
  AFTER INSERT OR UPDATE ON public.review_scores
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_review_last_saved();

CREATE TRIGGER trg_enforce_all_criteria_scored
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_all_criteria_scored();

CREATE TRIGGER trg_reviews_submitted_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.set_submitted_at();

CREATE TRIGGER trg_reviews_updated_at
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_guard_preset_rubrics
  BEFORE UPDATE ON public.rubrics
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_preset_rubrics();

CREATE POLICY "Users can insert their own chat events" ON "public"."ai_chat_events"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "Users can manage messages in their own sessions" ON "public"."ai_chat_messages"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.ai_chat_sessions s
  WHERE ((s.id = ai_chat_messages.session_id) AND (s.user_id = auth.uid())))));

CREATE POLICY "Users can manage their own chat sessions" ON "public"."ai_chat_sessions"
  FOR ALL
  TO PUBLIC
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "annotations_delete_own" ON "public"."annotations"
  FOR DELETE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "annotations_insert_own" ON "public"."annotations"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "annotations_select_document_author" ON "public"."annotations"
  FOR SELECT
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM (public.reviews r
     JOIN public.documents d ON ((d.id = r.document_id)))
  WHERE ((r.id = annotations.review_id) AND (d.author_id = auth.uid()) AND (((annotations.rubric_item_id IS NOT NULL) AND (EXISTS ( SELECT 1
           FROM public.rubric_items ri
          WHERE ((ri.id = annotations.rubric_item_id) AND public.rubric_submitted_for_review(r.id, ri.rubric_id))))) OR
            ((annotations.rubric_item_id IS NULL) AND public.review_has_submission(r.id)))))) AND public.review_approved_for_author(review_id)));

CREATE POLICY "annotations_select_org_coordinator" ON "public"."annotations"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND public.is_org_coordinator_for_document(r.document_id) AND public.review_has_submission(r.id)))));

CREATE POLICY "annotations_select_own" ON "public"."annotations"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND (r.reviewer_id = auth.uid())))));

CREATE POLICY "annotations_update_own" ON "public"."annotations"
  FOR UPDATE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = annotations.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "afc_author_all" ON "public"."author_feedback_comments"
  FOR ALL
  TO PUBLIC
  USING (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = author_feedback_comments.document_id) AND (d.author_id = auth.uid()))))))
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = author_feedback_comments.document_id) AND (d.author_id = auth.uid()))))));

CREATE POLICY "afr_author_all" ON "public"."author_feedback_responses"
  FOR ALL
  TO PUBLIC
  USING (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = author_feedback_responses.document_id) AND (d.author_id = auth.uid()))))))
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = author_feedback_responses.document_id) AND (d.author_id = auth.uid()))))));

CREATE POLICY "reviewer_own_acceptances" ON "public"."document_acceptances"
  FOR ALL
  TO "authenticated"
  USING ((reviewer_id = auth.uid()))
  WITH CHECK ((reviewer_id = auth.uid()));

CREATE POLICY "coordinators_manage_assignments" ON "public"."document_assignments"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (('coordinator'::text = ANY (u.roles)) OR (u.role = 'admin'::public.user_role))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.users u
  WHERE ((u.id = auth.uid()) AND (('coordinator'::text = ANY (u.roles)) OR (u.role = 'admin'::public.user_role))))));

CREATE POLICY "reviewers_view_own_assignments" ON "public"."document_assignments"
  FOR SELECT
  TO "authenticated"
  USING ((reviewer_id = auth.uid()));

CREATE POLICY "document_rubrics: authenticated read" ON "public"."document_rubrics"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "document_rubrics: author delete" ON "public"."document_rubrics"
  FOR DELETE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.documents
  WHERE ((documents.id = document_rubrics.document_id) AND (documents.author_id = auth.uid())))));

CREATE POLICY "document_rubrics: author insert" ON "public"."document_rubrics"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.documents
  WHERE ((documents.id = document_rubrics.document_id) AND (documents.author_id = auth.uid())))));

CREATE POLICY "documents: authenticated read" ON "public"."documents"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "documents: author delete" ON "public"."documents"
  FOR DELETE
  TO PUBLIC
  USING ((author_id = auth.uid()));

CREATE POLICY "documents: author insert" ON "public"."documents"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((author_id = auth.uid()));

CREATE POLICY "documents: author select own" ON "public"."documents"
  FOR SELECT
  TO PUBLIC
  USING ((author_id = auth.uid()));

CREATE POLICY "documents: author update" ON "public"."documents"
  FOR UPDATE
  TO PUBLIC
  USING ((author_id = auth.uid()))
  WITH CHECK ((author_id = auth.uid()));

CREATE POLICY "institutions: insert authenticated" ON "public"."institutions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (true);

CREATE POLICY "institutions: read all" ON "public"."institutions"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "reviewer_own_declines" ON "public"."review_declines"
  FOR ALL
  TO "authenticated"
  USING ((reviewer_id = auth.uid()))
  WITH CHECK ((reviewer_id = auth.uid()));

CREATE POLICY "Reviewers can insert their own events" ON "public"."review_events"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((reviewer_id = auth.uid()));

CREATE POLICY "Reviewers can view their own events" ON "public"."review_events"
  FOR SELECT
  TO PUBLIC
  USING ((reviewer_id = auth.uid()));

CREATE POLICY "review_rubric_submissions_insert_own" ON "public"."review_rubric_submissions"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_rubric_submissions.review_id) AND (r.reviewer_id = auth.uid())))));

CREATE POLICY "review_rubric_submissions_select_document_author" ON "public"."review_rubric_submissions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM (public.reviews r
     JOIN public.documents d ON ((d.id = r.document_id)))
  WHERE ((r.id = review_rubric_submissions.review_id) AND (d.author_id = auth.uid())))));

CREATE POLICY "review_rubric_submissions_select_own" ON "public"."review_rubric_submissions"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_rubric_submissions.review_id) AND (r.reviewer_id = auth.uid())))));

CREATE POLICY "rrs_delete_org_coordinator" ON "public"."review_rubric_submissions"
  FOR DELETE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_rubric_submissions.review_id) AND public.is_org_coordinator_for_document(r.document_id)))));

CREATE POLICY "rrs_select_org_coordinator" ON "public"."review_rubric_submissions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_rubric_submissions.review_id) AND public.is_org_coordinator_for_document(r.document_id)))));

CREATE POLICY "review_scores_delete_own" ON "public"."review_scores"
  FOR DELETE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "review_scores_insert_own" ON "public"."review_scores"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "review_scores_select_document_author" ON "public"."review_scores"
  FOR SELECT
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM ((public.reviews r
     JOIN public.documents d ON ((d.id = r.document_id)))
     JOIN public.rubric_items ri ON ((ri.id = review_scores.rubric_item_id)))
  WHERE ((r.id = review_scores.review_id) AND (d.author_id = auth.uid()) AND public.rubric_submitted_for_review(r.id, ri.rubric_id)))) AND
    public.review_approved_for_author(review_id)));

CREATE POLICY "review_scores_select_org_coordinator" ON "public"."review_scores"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND public.is_org_coordinator_for_document(r.document_id) AND public.review_has_submission(r.id)))));

CREATE POLICY "review_scores_select_own" ON "public"."review_scores"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND (r.reviewer_id = auth.uid())))));

CREATE POLICY "review_scores_update_own" ON "public"."review_scores"
  FOR UPDATE
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = review_scores.review_id) AND (r.reviewer_id = auth.uid()) AND (r.status = 'in_progress'::public.review_status)))));

CREATE POLICY "reviews_insert_own" ON "public"."reviews"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((reviewer_id = auth.uid()));

CREATE POLICY "reviews_select_document_author" ON "public"."reviews"
  FOR SELECT
  TO PUBLIC
  USING (((EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = reviews.document_id) AND (d.author_id = auth.uid())))) AND public.review_has_submission(id) AND public.review_approved_for_author(id)));

CREATE POLICY "reviews_select_org_coordinator" ON "public"."reviews"
  FOR SELECT
  TO PUBLIC
  USING (public.is_org_coordinator_for_document(document_id));

CREATE POLICY "reviews_select_own" ON "public"."reviews"
  FOR SELECT
  TO "authenticated"
  USING ((reviewer_id = auth.uid()));

CREATE POLICY "reviews_update_org_coordinator" ON "public"."reviews"
  FOR UPDATE
  TO PUBLIC
  USING (public.is_org_coordinator_for_document(document_id))
  WITH CHECK (public.is_org_coordinator_for_document(document_id));

CREATE POLICY "reviews_update_own" ON "public"."reviews"
  FOR UPDATE
  TO PUBLIC
  USING (((reviewer_id = auth.uid()) AND (status = ANY (ARRAY['assigned'::public.review_status, 'in_progress'::public.review_status]))))
  WITH CHECK ((reviewer_id = auth.uid()));

CREATE POLICY "revision_notes_author_all" ON "public"."revision_notes"
  FOR ALL
  TO PUBLIC
  USING (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = revision_notes.document_id) AND (d.author_id = auth.uid()))))))
  WITH CHECK (((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public.documents d
  WHERE ((d.id = revision_notes.document_id) AND (d.author_id = auth.uid()))))));

CREATE POLICY "rubric_items: admin write" ON "public"."rubric_items"
  FOR ALL
  TO PUBLIC
  USING ((public.current_user_role() = 'admin'::public.user_role))
  WITH CHECK ((public.current_user_role() = 'admin'::public.user_role));

CREATE POLICY "rubric_items: authenticated read" ON "public"."rubric_items"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "rubric_items_select" ON "public"."rubric_items"
  FOR SELECT
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.rubrics r
  WHERE ((r.id = rubric_items.rubric_id) AND (r.is_preset = true)))));

CREATE POLICY "rubrics: admin write" ON "public"."rubrics"
  FOR ALL
  TO PUBLIC
  USING ((public.current_user_role() = 'admin'::public.user_role))
  WITH CHECK ((public.current_user_role() = 'admin'::public.user_role));

CREATE POLICY "rubrics: authenticated read" ON "public"."rubrics"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "rubrics_select_preset" ON "public"."rubrics"
  FOR SELECT
  TO "authenticated"
  USING ((is_preset = true));

CREATE POLICY "reviewer_own_score_comments" ON "public"."score_comments"
  FOR ALL
  TO "authenticated"
  USING ((EXISTS ( SELECT 1
   FROM public.reviews
  WHERE ((reviews.id = score_comments.review_id) AND (reviews.reviewer_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.reviews
  WHERE ((reviews.id = score_comments.review_id) AND (reviews.reviewer_id = auth.uid())))));

CREATE POLICY "score_comments_select_org_coordinator" ON "public"."score_comments"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.reviews r
  WHERE ((r.id = score_comments.review_id) AND public.is_org_coordinator_for_document(r.document_id) AND public.review_has_submission(r.id)))));

CREATE POLICY "users: admin select all" ON "public"."users"
  FOR SELECT
  TO PUBLIC
  USING ((public.current_user_role() = 'admin'::public.user_role));

CREATE POLICY "users: authenticated read profile" ON "public"."users"
  FOR SELECT
  TO PUBLIC
  USING ((auth.role() = 'authenticated'::text));

CREATE POLICY "users: insert own" ON "public"."users"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "users: select own" ON "public"."users"
  FOR SELECT
  TO PUBLIC
  USING ((id = auth.uid()));

CREATE POLICY "users: update own" ON "public"."users"
  FOR UPDATE
  TO PUBLIC
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "Authenticated users can read screenshots 1ym93gt_0" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING ((bucket_id = 'screenshots'::text));

CREATE POLICY "Authenticated users can read snapshots" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING ((bucket_id = 'openstax-snapshots'::text));

CREATE POLICY "Authenticated users can upload screenshots 1ym93gt_0" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((bucket_id = 'screenshots'::text));

CREATE POLICY "Authenticated users can upload snapshots" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((bucket_id = 'openstax-snapshots'::text));

CREATE POLICY "storage: authenticated read" ON "storage"."objects"
  FOR SELECT
  TO "authenticated"
  USING ((bucket_id = 'documents'::text));

CREATE POLICY "storage: authenticated upload" ON "storage"."objects"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "storage: owner delete" ON "storage"."objects"
  FOR DELETE
  TO "authenticated"
  USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE POLICY "storage: owner update" ON "storage"."objects"
  FOR UPDATE
  TO "authenticated"
  USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)));

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

COMMENT ON COLUMN "public"."documents"."report_status" IS 'Author decision on the released review report: null = awaiting decision / not yet released, revising = author is addressing feedback, published = publicly accessible (Adopter surface pending), private = kept private (Completed Submissions tab).';

COMMENT ON COLUMN "public"."documents"."revised_link" IS 'Author-supplied URL to the revised OER, submitted during the report revision flow (report_status = revising).';

COMMENT ON COLUMN "public"."users"."role" IS 'delete later';

GRANT EXECUTE ON FUNCTION "public"."auto_decline_other_assignments"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."auto_decline_other_assignments"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_decline_other_assignments"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."auto_decline_other_assignments"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."current_user_role"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."current_user_role"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."enforce_all_criteria_scored"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."enforce_all_criteria_scored"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_all_criteria_scored"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."enforce_all_criteria_scored"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."guard_preset_rubrics"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."guard_preset_rubrics"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."guard_preset_rubrics"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."guard_preset_rubrics"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_org_coordinator_for_document"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_org_coordinator_for_document"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_org_coordinator_for_document"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_org_coordinator_for_document"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_annotations"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."lock_submitted_annotations"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_annotations"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_annotations"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_review_scores"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."lock_submitted_review_scores"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_review_scores"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."lock_submitted_review_scores"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."review_approved_for_author"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."review_approved_for_author"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_approved_for_author"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_approved_for_author"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."review_has_submission"(uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."review_has_submission"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_has_submission"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."review_has_submission"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."rubric_submitted_for_review"(uuid, uuid) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."rubric_submitted_for_review"(uuid, uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."rubric_submitted_for_review"(uuid, uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."rubric_submitted_for_review"(uuid, uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_review_score_document_id"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_review_score_document_id"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_review_score_document_id"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_review_score_document_id"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."set_submitted_at"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_submitted_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_submitted_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_submitted_at"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."touch_review_last_saved"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."touch_review_last_saved"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."touch_review_last_saved"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."touch_review_last_saved"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_torus_document_pages"(uuid, text, jsonb) TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."update_torus_document_pages"(uuid, text, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_torus_document_pages"(uuid, text, jsonb) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_torus_document_pages"(uuid, text, jsonb) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_updated_at"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."update_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_updated_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_updated_at"() TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_events" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."ai_chat_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_messages" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."ai_chat_messages" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_messages" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_messages" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_sessions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."ai_chat_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ai_chat_sessions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."annotations" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."annotations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."annotations" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."annotations" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_comments" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."author_feedback_comments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_comments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_comments" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_responses" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."author_feedback_responses" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_responses" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."author_feedback_responses" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_acceptances" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."document_acceptances" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_acceptances" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_acceptances" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_assignments" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."document_assignments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_assignments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_assignments" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_rubrics" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."document_rubrics" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_rubrics" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."document_rubrics" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."documents" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."documents" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."documents" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."documents" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."institutions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."institutions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."institutions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."institutions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_declines" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."review_declines" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_declines" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_declines" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_events" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."review_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_events" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_events" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_rubric_submissions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."review_rubric_submissions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_rubric_submissions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_rubric_submissions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_scores" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."review_scores" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_scores" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."review_scores" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reviews" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."reviews" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reviews" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reviews" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."revision_notes" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."revision_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."revision_notes" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."revision_notes" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubric_items" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."rubric_items" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubric_items" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubric_items" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubrics" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."rubrics" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubrics" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."rubrics" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."score_comments" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."score_comments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."score_comments" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."score_comments" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."users" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."users" TO "service_role";

