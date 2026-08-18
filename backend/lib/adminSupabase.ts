import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "./supabase/env";

type GenericAdminTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

type AuditLogTable = {
  Row: {
    id: string;
    actor_user_id: string;
    action: string;
    target_type: string;
    target_id: string | null;
    result: string;
    reason: string | null;
    request_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  Insert: {
    id?: string;
    actor_user_id: string;
    action: string;
    target_type: string;
    target_id?: string | null;
    result: string;
    reason?: string | null;
    request_id?: string | null;
    metadata?: Record<string, unknown>;
    created_at?: string;
  };
  Update: never;
  Relationships: [];
};

type MonitoringEventTable = {
  Row: {
    id: string;
    request_id: string | null;
    event_type: string;
    route: string | null;
    method: string | null;
    status: number | null;
    duration_ms: number | null;
    provider: string | null;
    model: string | null;
    retry_count: number | null;
    fallback_used: boolean | null;
    error_category: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
  };
  Insert: {
    id?: string;
    request_id?: string | null;
    event_type: string;
    route?: string | null;
    method?: string | null;
    status?: number | null;
    duration_ms?: number | null;
    provider?: string | null;
    model?: string | null;
    retry_count?: number | null;
    fallback_used?: boolean | null;
    error_category?: string | null;
    metadata?: Record<string, unknown>;
    created_at?: string;
  };
  Update: never;
  Relationships: [];
};

type BackgroundJobTable = {
  Row: {
    id: string;
    job_type: string;
    status: string;
    user_id: string | null;
    file_id: string | null;
    note_id: string | null;
    idempotency_key: string | null;
    payload: Record<string, unknown>;
    progress: Record<string, unknown>;
    attempt_count: number;
    max_attempts: number;
    locked_at: string | null;
    locked_by: string | null;
    next_run_at: string;
    last_error_category: string | null;
    last_error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    job_type: string;
    status?: string;
    user_id?: string | null;
    file_id?: string | null;
    note_id?: string | null;
    idempotency_key?: string | null;
    payload?: Record<string, unknown>;
    progress?: Record<string, unknown>;
    attempt_count?: number;
    max_attempts?: number;
    locked_at?: string | null;
    locked_by?: string | null;
    next_run_at?: string;
    last_error_category?: string | null;
    last_error_message?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Partial<BackgroundJobTable["Insert"]>;
  Relationships: [];
};

type AdminDatabase = {
  public: {
    Tables: {
      audit_logs: AuditLogTable;
      monitoring_events: MonitoringEventTable;
      background_jobs: BackgroundJobTable;
      files: GenericAdminTable;
      notes: GenericAdminTable;
      ai_outputs: GenericAdminTable;
      assistant_questions: GenericAdminTable;
      quizzes: GenericAdminTable;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

let adminSupabaseClient: SupabaseClient<AdminDatabase> | null = null;
let adminSupabaseFingerprint = "";

function getServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured. Add it to your server environment.");
  }
  return key;
}

export function createAdminSupabaseClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = getServiceRoleKey();
  const fingerprint = `${url}:${serviceRoleKey}`;

  if (adminSupabaseClient && adminSupabaseFingerprint === fingerprint) return adminSupabaseClient;

  adminSupabaseClient = createClient<AdminDatabase>(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  adminSupabaseFingerprint = fingerprint;

  return adminSupabaseClient;
}

export async function getAdminSupabaseClient() {
  return createAdminSupabaseClient();
}

export function hasAdminSupabaseEnv(): boolean {
  try {
    getSupabaseEnv();
    getServiceRoleKey();
    return true;
  } catch {
    return false;
  }
}

export function getAdminSupabaseConfig() {
  const { url } = getSupabaseEnv();
  return { url, serviceRoleKey: getServiceRoleKey() };
}

export function resetAdminSupabaseClientForTests(): void {
  if (process.env.NODE_ENV !== "test") return;
  adminSupabaseClient = null;
  adminSupabaseFingerprint = "";
}
