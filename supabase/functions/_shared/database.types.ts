// Generated-compatible baseline derived from the linked production Supabase schema on 2026-07-10.
// Scope is intentionally limited to tables used by the current Edge Functions.
// Regenerate the complete file after the Stage 7 migration is deployed to Supabase staging/production.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      analysis_jobs: {
        Row: {
          created_at: string;
          current_step: string;
          error_message: string | null;
          finished_at: string | null;
          id: string;
          input_payload: Json;
          job_type: string;
          output_payload: Json;
          owner_id: string;
          policy_id: string | null;
          priority: number;
          progress: number;
          requested_role: string;
          requested_subscription_tier: string;
          source_name: string | null;
          source_url: string | null;
          started_at: string | null;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          current_step?: string;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          input_payload?: Json;
          job_type?: string;
          output_payload?: Json;
          owner_id?: string;
          policy_id?: string | null;
          priority?: number;
          progress?: number;
          requested_role?: string;
          requested_subscription_tier?: string;
          source_name?: string | null;
          source_url?: string | null;
          started_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          current_step?: string;
          error_message?: string | null;
          finished_at?: string | null;
          id?: string;
          input_payload?: Json;
          job_type?: string;
          output_payload?: Json;
          owner_id?: string;
          policy_id?: string | null;
          priority?: number;
          progress?: number;
          requested_role?: string;
          requested_subscription_tier?: string;
          source_name?: string | null;
          source_url?: string | null;
          started_at?: string | null;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_jobs_policy_id_fkey";
            columns: ["policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          }
        ];
      };
      policies: {
        Row: {
          analysis_version: string;
          canonical_source_url: string | null;
          category: string | null;
          confidence: number | null;
          content_hash: string | null;
          created_at: string;
          created_by: string | null;
          dedupe_key: string | null;
          duplicate_of_policy_id: string | null;
          effective_date: string | null;
          external_id: string | null;
          full_text: string | null;
          id: string;
          issuer: string | null;
          jurisdiction: string | null;
          metadata: Json;
          owner_id: string | null;
          policy_level: string | null;
          policy_no: string | null;
          publish_date: string | null;
          published_at: string | null;
          required_role: string;
          required_subscription_tier: string;
          search_vector: unknown;
          source_id: string | null;
          source_name: string | null;
          source_url: string | null;
          status: string;
          summary: string | null;
          tags: string[];
          title: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          analysis_version?: string;
          canonical_source_url?: string | null;
          category?: string | null;
          confidence?: number | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          duplicate_of_policy_id?: string | null;
          effective_date?: string | null;
          external_id?: string | null;
          full_text?: string | null;
          id?: string;
          issuer?: string | null;
          jurisdiction?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          policy_level?: string | null;
          policy_no?: string | null;
          publish_date?: string | null;
          published_at?: string | null;
          required_role?: string;
          required_subscription_tier?: string;
          search_vector?: unknown;
          source_id?: string | null;
          source_name?: string | null;
          source_url?: string | null;
          status?: string;
          summary?: string | null;
          tags?: string[];
          title: string;
          updated_at?: string;
          visibility?: string;
        };
        Update: {
          analysis_version?: string;
          canonical_source_url?: string | null;
          category?: string | null;
          confidence?: number | null;
          content_hash?: string | null;
          created_at?: string;
          created_by?: string | null;
          dedupe_key?: string | null;
          duplicate_of_policy_id?: string | null;
          effective_date?: string | null;
          external_id?: string | null;
          full_text?: string | null;
          id?: string;
          issuer?: string | null;
          jurisdiction?: string | null;
          metadata?: Json;
          owner_id?: string | null;
          policy_level?: string | null;
          policy_no?: string | null;
          publish_date?: string | null;
          published_at?: string | null;
          required_role?: string;
          required_subscription_tier?: string;
          search_vector?: unknown;
          source_id?: string | null;
          source_name?: string | null;
          source_url?: string | null;
          status?: string;
          summary?: string | null;
          tags?: string[];
          title?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [
          {
            foreignKeyName: "policies_duplicate_of_policy_id_fkey";
            columns: ["duplicate_of_policy_id"];
            isOneToOne: false;
            referencedRelation: "policies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "policies_source_id_fkey";
            columns: ["source_id"];
            isOneToOne: false;
            referencedRelation: "policy_sources";
            referencedColumns: ["id"];
          }
        ];
      };
      policy_sources: {
        Row: {
          authority_level: string;
          crawl_priority: number;
          created_at: string;
          created_by: string | null;
          dedupe_priority: number;
          homepage_url: string | null;
          id: string;
          jurisdiction: string | null;
          list_url: string | null;
          metadata: Json;
          name: string;
          publisher: string | null;
          reliability_score: number;
          source_key: string | null;
          source_type: string;
          status: string;
          updated_at: string;
        };
        Insert: {
          authority_level?: string;
          crawl_priority?: number;
          created_at?: string;
          created_by?: string | null;
          dedupe_priority?: number;
          homepage_url?: string | null;
          id?: string;
          jurisdiction?: string | null;
          list_url?: string | null;
          metadata?: Json;
          name: string;
          publisher?: string | null;
          reliability_score?: number;
          source_key?: string | null;
          source_type?: string;
          status?: string;
          updated_at?: string;
        };
        Update: {
          authority_level?: string;
          crawl_priority?: number;
          created_at?: string;
          created_by?: string | null;
          dedupe_priority?: number;
          homepage_url?: string | null;
          id?: string;
          jurisdiction?: string | null;
          list_url?: string | null;
          metadata?: Json;
          name?: string;
          publisher?: string | null;
          reliability_score?: number;
          source_key?: string | null;
          source_type?: string;
          status?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          display_name: string | null;
          id: string;
          metadata: Json;
          organization_name: string | null;
          role: string;
          status: string;
          subscription_status: string;
          subscription_tier: string;
          updated_at: string;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id: string;
          metadata?: Json;
          organization_name?: string | null;
          role?: string;
          status?: string;
          subscription_status?: string;
          subscription_tier?: string;
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string | null;
          id?: string;
          metadata?: Json;
          organization_name?: string | null;
          role?: string;
          status?: string;
          subscription_status?: string;
          subscription_tier?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      list_pending_policy_analysis: {
        Args: { limit_count?: number };
        Returns: Json;
      };
    };
    Enums: {};
    CompositeTypes: {};
  };
};

export type PublicTables = Database["public"]["Tables"];
export type TableRow<Name extends keyof PublicTables> = PublicTables[Name]["Row"];
export type TableInsert<Name extends keyof PublicTables> = PublicTables[Name]["Insert"];
export type TableUpdate<Name extends keyof PublicTables> = PublicTables[Name]["Update"];
