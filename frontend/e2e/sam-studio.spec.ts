import { expect, test, type Page, type Route } from "@playwright/test";
import fs from "fs";
import path from "path";

import type { Job, MixResponse } from "../lib/types";

const demoPath = path.resolve(__dirname, "../../demo.mp3");
const demoBuffer = fs.readFileSync(demoPath);
const outputName = "output-e2e.wav";

const baseCandidates = [
  {
    label: "music",
    score: 0.92,
    segments: [
      { t0: 2, t1: 6, score: 0.92 },
      { t0: 18, t1: 22, score: 0.88 },
    ],
  },
  {
    label: "speech",
    score: 0.64,
    segments: [{ t0: 6, t1: 10, score: 0.73 }],
  },
  {
    label: "keyboard typing",
    score: 0.32,
    segments: [],
  },
];

const makeJob = (id: string, overrides: Partial<Job> = {}): Job => {
  const timestamp = "2025-01-01T00:00:00Z";
  return {
    id,
    status: "DONE",
    created_at: timestamp,
    updated_at: timestamp,
    candidates: baseCandidates,
    file_name: "demo.mp3",
    duration_seconds: 42,
    last_mix: null,
    mix_history: [],
    ...overrides,
  };
};

const fulfillJson = (route: Route, payload: unknown) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(payload),
  });

const serveAudio = async (page: Page) => {
  await page.route("**/api/assets/**", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(demoBuffer.length),
      },
      body: demoBuffer,
    });
  });
};

const setupApiMocks = async (
  page: Page,
  state: {
    jobs: Job[];
    activeJob: Job;
    mixState: {
      requestCount: number;
      pending: boolean;
      cancelled: boolean;
      forceRunning: boolean;
    };
  },
) => {
  await serveAudio(page);
  await page.route("**/api/jobs**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const isJobsCollection = path === "/api/jobs" || path === "/api/jobs/";
    const cleanupPath = path === "/api/jobs/cleanup" || path === "/api/jobs/cleanup/";
    const mixMatch = path.match(/^\/api\/jobs\/([^/]+)\/mix$/);
    const cancelMatch = path.match(/^\/api\/jobs\/([^/]+)\/mix\/cancel$/);
    const deleteMatch = path.match(/^\/api\/jobs\/([^/]+)$/);

    if (cleanupPath && method === "POST") {
      const payload = request.postDataJSON() as {
        keep_latest?: number;
        clear_outputs?: boolean;
        clear_cache?: boolean;
      };
      let removedJobs: string[] = [];
      if (typeof payload.keep_latest === "number") {
        const keepLatest = Math.max(0, payload.keep_latest);
        removedJobs = state.jobs.slice(keepLatest).map((job) => job.id);
        state.jobs = state.jobs.slice(0, keepLatest);
      }
      if (payload.clear_outputs) {
        state.jobs = state.jobs.map((job) => ({
          ...job,
          last_mix: null,
          mix_history: [],
        }));
      }
      return fulfillJson(route, {
        removed_jobs: removedJobs,
        remaining_jobs: state.jobs.length,
        cleared_outputs: payload.clear_outputs ? state.jobs.length : 0,
        cleared_cache: Boolean(payload.clear_cache),
      });
    }

    if (isJobsCollection && method === "POST") {
      return fulfillJson(route, state.activeJob);
    }

    if (isJobsCollection && method === "GET") {
      return fulfillJson(route, state.jobs);
    }

    if (cancelMatch && method === "POST") {
      state.mixState.cancelled = true;
      state.mixState.pending = false;
      state.mixState.forceRunning = false;
      const response: MixResponse = {
        job_id: state.activeJob.id,
        status: "CANCELLED",
        detail: "Cancelled by test",
      };
      return fulfillJson(route, response);
    }

    if (mixMatch && method === "POST") {
      state.mixState.cancelled = false;
      state.mixState.requestCount += 1;
      if (state.mixState.forceRunning) {
        state.mixState.forceRunning = false;
        state.mixState.pending = true;
        const response: MixResponse = {
          job_id: state.activeJob.id,
          status: "RUNNING",
          progress: 0.2,
          chunks_done: 1,
          chunks_total: 3,
          eta_seconds: 45,
        };
        return fulfillJson(route, response);
      }
      const response: MixResponse = {
        job_id: state.activeJob.id,
        status: "DONE",
        output_url: `/assets/${state.activeJob.id}/output?name=${outputName}`,
      };
      return fulfillJson(route, response);
    }

    if (mixMatch && method === "GET") {
      if (state.mixState.cancelled) {
        const response: MixResponse = {
          job_id: state.activeJob.id,
          status: "CANCELLED",
          detail: "Cancelled by test",
        };
        return fulfillJson(route, response);
      }
      if (state.mixState.pending) {
        const response: MixResponse = {
          job_id: state.activeJob.id,
          status: "RUNNING",
          progress: 0.4,
          chunks_done: 1,
          chunks_total: 3,
          eta_seconds: 30,
        };
        return fulfillJson(route, response);
      }
      const response: MixResponse = {
        job_id: state.activeJob.id,
        status: "DONE",
        output_url: `/assets/${state.activeJob.id}/output?name=${outputName}`,
      };
      return fulfillJson(route, response);
    }

    if (deleteMatch && method === "DELETE") {
      const jobId = deleteMatch[1];
      state.jobs = state.jobs.filter((job) => job.id !== jobId);
      return fulfillJson(route, { id: jobId, status: "DELETED" });
    }

    return route.fulfill({ status: 404, body: "Not mocked" });
  });
};

test("upload, preview, cancel, restart, and render mix", async ({ page }) => {
  const job = makeJob("e2e1-job-a");
  const state = {
    jobs: [job],
    activeJob: job,
    mixState: {
      requestCount: 0,
      pending: false,
      cancelled: false,
      forceRunning: true,
    },
  };
  await setupApiMocks(page, state);

  await page.goto("/");
  await page.getByTestId("upload-input").setInputFiles(demoPath);

  await expect(page.getByTestId("candidate-music")).toBeVisible();
  await expect(page.getByTestId("candidate-speech")).toBeVisible();

  await page.getByTestId("candidate-clear").click();
  await expect(page.getByTestId("render-preview")).toHaveCount(0);
  await page.getByTestId("candidate-select-all").click();
  await expect(page.getByTestId("render-preview")).toBeEnabled();

  await page.getByTestId("mix-mode-remove").click();
  await expect(page.getByTestId("gain-music")).toBeDisabled();
  await page.getByTestId("mix-mode-keep").click();
  await expect(page.getByTestId("gain-music")).toBeEnabled();

  await page.getByTestId("prompt-input").fill("air conditioner hum");
  await page.getByTestId("prompt-add").click();
  await expect(page.getByTestId("candidate-air-conditioner-hum")).toBeVisible();

  await page.getByTestId("preview-length").selectOption("5");
  await page.getByTestId("preview-start").fill("2");

  await page.getByTestId("render-preview").click();
  await expect(page.getByTestId("ab-status")).toHaveText("Rendering preview...");
  await page.getByTestId("mix-cancel").click();
  await expect(page.getByTestId("ab-status")).toHaveText("Cancelled");

  await page.getByTestId("mix-restart").click();
  await expect(page.getByTestId("ab-status")).toHaveText("Preview ready");
  await expect(page.getByTestId("audio-processed")).toHaveAttribute("src", /\/api\/assets\//);

  await page.getByTestId("ab-toggle").click();
  await expect(page.getByTestId("ab-toggle")).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("render-mix").click();
  await expect(page.getByTestId("ab-status")).toHaveText("Mix ready");
});

test("history search, filter, delete, and cleanup", async ({ page }) => {
  const doneJob = makeJob("e2e2-job-a", {
    file_name: "alpha-demo.mp3",
    last_mix: {
      kind: "preview",
      output_name: outputName,
      preview_seconds: 10,
      preview_start: 0,
      updated_at: "2025-01-01T00:10:00Z",
    },
  });
  const failedJob = makeJob("e2e3-job-b", {
    status: "FAILED",
    file_name: "beta-fail.mp3",
  });
  const state = {
    jobs: [doneJob, failedJob],
    activeJob: doneJob,
    mixState: {
      requestCount: 0,
      pending: false,
      cancelled: false,
      forceRunning: false,
    },
  };
  await setupApiMocks(page, state);

  await page.goto("/");
  await page.getByTestId("history-toggle").click();
  await expect(page.getByTestId("job-history")).toBeVisible();

  await page.getByTestId("history-search").fill("alpha");
  await expect(page.getByTestId("history-list")).toContainText("alpha-demo.mp3");
  await page.getByTestId("history-search").fill("");

  await page.getByTestId("history-status").selectOption("FAILED");
  await expect(page.getByTestId("history-list")).toContainText("beta-fail.mp3");
  await expect(page.locator(`[data-testid="history-row-${doneJob.id.slice(0, 8)}"]`)).toHaveCount(0);
  await page.getByTestId("history-status").selectOption("all");

  await page.getByTestId(`history-row-${doneJob.id.slice(0, 8)}`).click();
  await expect(page.getByTestId("job-history")).toHaveCount(0);

  await page.getByTestId("history-toggle").click();
  await page.getByTestId(`history-delete-${failedJob.id.slice(0, 8)}`).click();
  await expect(page.locator(`[data-testid="history-row-${failedJob.id.slice(0, 8)}"]`)).toHaveCount(0);

  page.on("dialog", (dialog) => dialog.accept());
  await page.getByTestId("history-keep-latest").fill("1");
  await page.getByTestId("history-clear-outputs").check();
  await page.getByTestId("history-cleanup-run").click();
  await expect(page.getByText(/Removed \d+ job/)).toBeVisible();
});
