import { createClient } from "https://esm.sh/@supabase/supabase-js@2.75.1";
import { HttpError } from "./http.ts";

type SupabaseAdminClient = ReturnType<typeof createClient>;

export type AuthenticatedUser = {
  id: string;
  email?: string;
};

export type AnalysisJobRecord = {
  id: string;
  owner_id: string;
  policy_id: string | null;
  title: string;
  source_url: string | null;
  source_name: string | null;
  status: string;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
};

export type PrivilegedFunctionUser = AuthenticatedUser & {
  role: "admin";
  source: "admin" | "crawler";
};

export function createSupabaseAdminClient(): SupabaseAdminClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(500, "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export async function requireAuthenticatedUser(
  req: Request,
  supabase: SupabaseAdminClient
): Promise<AuthenticatedUser> {
  const authorization = req.headers.get("Authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");

  if (!token) {
    throw new HttpError(401, "Missing bearer token.");
  }

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new HttpError(401, "Invalid bearer token.", error);
  }

  return {
    id: data.user.id,
    email: data.user.email
  };
}

export async function requireActiveAdminUser(
  req: Request,
  supabase: SupabaseAdminClient
): Promise<PrivilegedFunctionUser> {
  const user = await requireAuthenticatedUser(req, supabase);
  await verifyActiveAdminProfile(supabase, user.id);
  return { ...user, role: "admin", source: "admin" };
}

export async function requireCrawlerOrAdminUser(
  req: Request,
  supabase: SupabaseAdminClient
): Promise<PrivilegedFunctionUser> {
  const crawlerSecret = req.headers.get("x-crawler-secret");

  if (crawlerSecret) {
    const expectedCrawlerSecret = Deno.env.get("CRAWLER_INGEST_SECRET");
    if (!expectedCrawlerSecret || crawlerSecret !== expectedCrawlerSecret) {
      throw new HttpError(401, "Invalid crawler secret.");
    }

    const crawlerOwnerId = Deno.env.get("CRAWLER_OWNER_ID");
    if (!crawlerOwnerId) {
      throw new HttpError(500, "CRAWLER_OWNER_ID is required for scheduled crawler ingest.");
    }

    await verifyActiveAdminProfile(supabase, crawlerOwnerId);
    return { id: crawlerOwnerId, role: "admin", source: "crawler" };
  }

  return requireActiveAdminUser(req, supabase);
}

export async function verifyActiveAdminProfile(
  supabase: SupabaseAdminClient,
  userId: string
): Promise<void> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role,status")
    .eq("id", userId)
    .maybeSingle();

  if (profileError) {
    throw new HttpError(500, "Unable to verify profile permissions.", profileError);
  }

  if (profile?.role !== "admin" || profile?.status !== "active") {
    throw new HttpError(403, "This operation requires an active admin profile.");
  }
}

export async function requireAnalysisJobRecord(
  supabase: SupabaseAdminClient,
  jobId: string
): Promise<AnalysisJobRecord> {
  const { data: job, error } = await supabase
    .from("analysis_jobs")
    .select("id,owner_id,policy_id,title,source_url,source_name,status,input_payload,output_payload")
    .eq("id", jobId)
    .single();

  if (error || !job) {
    throw new HttpError(404, "Analysis job not found.", error);
  }

  return job as AnalysisJobRecord;
}

export async function requireJobAccess(
  supabase: SupabaseAdminClient,
  userId: string,
  jobId: string
): Promise<AnalysisJobRecord> {
  try {
    await verifyActiveAdminProfile(supabase, userId);
  } catch {
    throw new HttpError(403, "You do not have access to this analysis job.");
  }

  return requireAnalysisJobRecord(supabase, jobId);
}
