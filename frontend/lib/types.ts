export type CandidateSegment = {
  t0: number;
  t1: number;
  score: number;
};

export type Candidate = {
  label: string;
  score: number;
  segments: CandidateSegment[];
  source?: "prompt";
};

export type JobMixSummary = {
  kind: "preview" | "full";
  output_name: string;
  preview_seconds?: number | null;
  preview_start?: number | null;
  updated_at?: string | null;
};

export type Job = {
  id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  created_at: string;
  updated_at?: string | null;
  detail?: string | null;
  error_code?: string | null;
  candidates?: Candidate[] | null;
  file_name?: string | null;
  duration_seconds?: number | null;
  last_mix?: JobMixSummary | null;
  mix_history?: JobMixSummary[] | null;
};

export type MixResponse = {
  job_id: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  output_url?: string | null;
  detail?: string | null;
  error_code?: string | null;
  progress?: number | null;
  chunks_done?: number | null;
  chunks_total?: number | null;
  eta_seconds?: number | null;
};
