import type { Database, Json } from "./database.types.ts";

export type Stage8Database = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: {
      publish_report_revision: {
        Args: {
          target_policy_id: string;
          target_revision_id: string;
          idempotency_key: string;
          actor_id: string;
          expected_current_revision_id?: string | null;
        };
        Returns: Json;
      };
      rollback_report_revision: {
        Args: {
          target_policy_id: string;
          target_revision_id: string;
          idempotency_key: string;
          actor_id: string;
          expected_current_revision_id?: string | null;
        };
        Returns: Json;
      };
      reserve_model_usage: {
        Args: {
          target_policy_id?: string | null;
          target_revision_id?: string | null;
          target_operation_type: string;
          target_provider?: string | null;
          target_model: string;
          target_prompt_version?: string | null;
          target_request_hash: string;
          target_budget_class: string;
          target_trigger_reason: string;
          planned_input_tokens: number;
          planned_output_tokens: number;
          actor_id: string;
          target_exception_reason?: string | null;
          target_metadata?: Json;
        };
        Returns: Json;
      };
      finalize_model_usage: {
        Args: {
          target_usage_id: string;
          actual_input_tokens: number;
          actual_output_tokens: number;
          actual_cached_tokens: number;
          target_status: string;
          actor_id: string;
          target_metadata?: Json;
        };
        Returns: Json;
      };
      set_user_account_status: {
        Args: {
          target_user_id: string;
          target_status: string;
          actor_id: string;
          reason: string;
        };
        Returns: Json;
      };
      purge_expired_user_events: {
        Args: {
          actor_id: string;
          reference_time?: string | null;
        };
        Returns: Json;
      };
      prepare_account_deletion: {
        Args: {
          target_user_id: string;
          request_key: string;
          actor_id: string;
          reason: string;
        };
        Returns: Json;
      };
      finalize_account_deletion: {
        Args: {
          target_request_id: string;
          succeeded: boolean;
          actor_id: string;
          deletion_error_message?: string | null;
        };
        Returns: Json;
      };
    };
  };
};
