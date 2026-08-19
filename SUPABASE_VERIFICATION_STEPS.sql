-- ============================================================
-- STUDYPILOT AI - HOSTED SUPABASE VERIFICATION STEPS
-- Run each section in Supabase Dashboard > SQL Editor
-- ============================================================

-- ============================================================
-- SECTION 1: CORE SCHEMA VERIFICATION (Phase 0 tables)
-- ============================================================

-- Check if core tables exist
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                     'revision_plans', 'assistant_questions', 'conversations')
ORDER BY table_name;

-- Check columns for each core table
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                     'revision_plans', 'assistant_questions', 'conversations')
ORDER BY table_name, ordinal_position;

-- Check RLS enabled
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                    'revision_plans', 'assistant_questions', 'conversations');

-- Check RLS policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                    'revision_plans', 'assistant_questions', 'conversations')
ORDER BY tablename, policyname;

-- Check indexes
SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                    'revision_plans', 'assistant_questions', 'conversations')
ORDER BY tablename, indexname;

-- Check foreign key constraints
SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                        'revision_plans', 'assistant_questions', 'conversations')
ORDER BY tc.table_name, kcu.column_name;

-- Check check constraints
SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc
  ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK'
  AND tc.table_schema = 'public'
  AND tc.table_name IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                        'revision_plans', 'assistant_questions', 'conversations')
ORDER BY tc.table_name, tc.constraint_name;


-- ============================================================
-- SECTION 2: PHASE 1-3 TABLES VERIFICATION
-- ============================================================

-- A. audit_logs verification
SELECT 'audit_logs' AS table_name, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'audit_logs';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_logs'
ORDER BY ordinal_position;

SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'audit_logs';

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'audit_logs';

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'audit_logs';

SELECT tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK' AND tc.table_schema = 'public' AND tc.table_name = 'audit_logs';

-- B. background_jobs verification
SELECT 'background_jobs' AS table_name, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'background_jobs';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'background_jobs'
ORDER BY ordinal_position;

SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'background_jobs';

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'background_jobs';

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'background_jobs';

SELECT tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK' AND tc.table_schema = 'public' AND tc.table_name = 'background_jobs';

SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name,
       ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage AS ccu
  ON ccu.constraint_name = tc.constraint_name
  AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
  AND tc.table_name = 'background_jobs';

-- C. monitoring_events verification
SELECT 'monitoring_events' AS table_name, table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'monitoring_events';

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'monitoring_events'
ORDER BY ordinal_position;

SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'monitoring_events';

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'monitoring_events';

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'monitoring_events';

SELECT tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK' AND tc.table_schema = 'public' AND tc.table_name = 'monitoring_events';


-- ============================================================
-- SECTION 3: STORAGE VERIFICATION
-- ============================================================

-- Check study-files bucket
SELECT id, name, public, allowed_mime_types, file_size_limit
FROM storage.buckets
WHERE id = 'study-files';

-- Check storage policies for study-files bucket
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'storage' AND tablename = 'objects'
  AND policyname LIKE '%study_files%';

-- Check if any objects exist (metadata only, no download)
SELECT bucket_id, name, metadata, created_at, updated_at
FROM storage.objects
WHERE bucket_id = 'study-files'
LIMIT 5;


-- ============================================================
-- SECTION 4: RLS BEHAVIOR VERIFICATION (No data exposure)
-- ============================================================

-- Verify auth.uid() based policies work correctly
-- These queries test policy logic without exposing data

-- Check that policies reference auth.uid()
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('audit_logs', 'background_jobs', 'monitoring_events')
  AND qual LIKE '%auth.uid()%';

-- Check admin role check in policies
SELECT schemaname, tablename, policyname, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('audit_logs', 'background_jobs', 'monitoring_events')
  AND qual LIKE '%app_metadata%';


-- ============================================================
-- SECTION 5: MIGRATION STATUS CHECK
-- ============================================================

-- Check for conversation_id column in assistant_questions
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'assistant_questions'
  AND column_name = 'conversation_id';

-- Check for language_code columns
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name = 'language_code'
  AND table_name IN ('conversations', 'assistant_questions', 'ai_outputs', 'quizzes', 'revision_plans')
ORDER BY table_name;

-- Check language_code check constraints
SELECT tc.table_name, tc.constraint_name, cc.check_clause
FROM information_schema.table_constraints tc
JOIN information_schema.check_constraints cc ON tc.constraint_name = cc.constraint_name
WHERE tc.constraint_type = 'CHECK'
  AND tc.table_schema = 'public'
  AND tc.constraint_name LIKE '%language_code_check%';

-- Check multilingual indexes
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE '%language%';


-- ============================================================
-- SECTION 6: FUNCTIONS AND TRIGGERS
-- ============================================================

-- Check set_updated_at function exists
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'set_updated_at';

-- Check triggers
SELECT event_object_table, trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table IN ('files', 'notes', 'ai_outputs', 'quizzes', 'quiz_attempts',
                             'revision_plans', 'assistant_questions', 'conversations',
                             'audit_logs', 'background_jobs', 'monitoring_events')
ORDER BY event_object_table, trigger_name;

-- Check normalize_study_note function and trigger
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'normalize_study_note';


-- ============================================================
-- SECTION 7: EXTENSIONS
-- ============================================================

SELECT extname, extversion
FROM pg_extension
WHERE extname IN ('pgcrypto', 'uuid-ossp');


-- ============================================================
-- INSTRUCTIONS FOR USE:
-- ============================================================
-- 1. Open Supabase Dashboard > SQL Editor
-- 2. Copy and run each SECTION separately
-- 3. Record results for each check (EXISTS/MISSING/MISCONFIGURED/NOT VERIFIED)
-- 4. Compare with local SQL files to determine migration status
-- 5. If migrations missing, apply them using the SQL Editor (see MIGRATION_COMMANDS.sql)
