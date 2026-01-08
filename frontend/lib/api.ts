import type { Job, MixResponse } from "@/lib/types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";

export type CreateJobOptions = {
  topN?: number;
  useYamnet?: boolean;
};

export type MixPayload = {
  prompts: string[];
  gains: number[];
  mode?: "keep" | "remove";
  preview?: boolean;
  previewSeconds?: number;
  previewStart?: number;
  force?: boolean;
};

export async function createJob(file: File, options: CreateJobOptions = {}) {
  const params = new URLSearchParams();
  if (options.topN !== undefined) {
    params.set("top_n", options.topN.toString());
  }
  if (options.useYamnet !== undefined) {
    params.set("use_yamnet", String(options.useYamnet));
  }

  const formData = new FormData();
  formData.append("file", file);

  const url = params.toString()
    ? `${API_BASE}/jobs/?${params.toString()}`
    : `${API_BASE}/jobs/`;

  const response = await fetch(url, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }

  return (await response.json()) as Job;
}

export async function createMix(jobId: string, payload: MixPayload) {
  const { previewSeconds, previewStart, ...rest } = payload;
  const body = {
    ...rest,
    ...(previewSeconds !== undefined ? { preview_seconds: previewSeconds } : {}),
    ...(previewStart !== undefined ? { preview_start: previewStart } : {}),
  };
  const response = await fetch(`${API_BASE}/jobs/${jobId}/mix`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }

  return (await response.json()) as MixResponse;
}

export async function getMixStatus(jobId: string) {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/mix`);
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return (await response.json()) as MixResponse;
}

export async function cancelMix(jobId: string) {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/mix/cancel`, {
    method: "POST",
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return (await response.json()) as MixResponse;
}

export async function listJobs() {
  const response = await fetch(`${API_BASE}/jobs/`);
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return (await response.json()) as Job[];
}

export async function deleteJob(jobId: string) {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return (await response.json()) as { id: string; status: string };
}

export type CleanupPayload = {
  keepLatest?: number;
  clearOutputs?: boolean;
  clearCache?: boolean;
};

export async function cleanupJobs(payload: CleanupPayload) {
  const response = await fetch(`${API_BASE}/jobs/cleanup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...(payload.keepLatest !== undefined ? { keep_latest: payload.keepLatest } : {}),
      ...(payload.clearOutputs !== undefined
        ? { clear_outputs: payload.clearOutputs }
        : {}),
      ...(payload.clearCache !== undefined ? { clear_cache: payload.clearCache } : {}),
    }),
  });
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return (await response.json()) as {
    removed_jobs: string[];
    remaining_jobs: number;
    cleared_outputs: number;
    cleared_cache: boolean;
  };
}

export function resolveApiUrl(path: string) {
  if (!path) {
    return path;
  }
  if (path.startsWith("http")) {
    return path;
  }
  const base = API_BASE.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function readError(response: Response) {
  const rawText = await response.text();
  if (!rawText) {
    return `Request failed (${response.status})`;
  }
  try {
    const payload = JSON.parse(rawText) as { detail?: string };
    return payload.detail ?? rawText;
  } catch {
    return rawText;
  }
}
