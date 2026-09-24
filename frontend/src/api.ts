export interface Market {
  market: string;
  name: string;
}

export type Period = "month" | "year" | "custom";

export interface DownloadRequest {
  market: string;
  minutes: number;
  period: Period;
  start?: string;
  end?: string;
}

export interface DownloadStatus {
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  candles: number;
  requests: number;
  message: string;
  file: string | null;
  first: string | null;
  last: string | null;
}

export const idleStatus: DownloadStatus = {
  status: "idle",
  progress: 0,
  candles: 0,
  requests: 0,
  message: "Choose your settings and start a download.",
  file: null,
  first: null,
  last: null,
};

export async function api<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api${path}`, options);

  if (!response.ok) {
    let message = `HTTP ${response.status}`;

    try {
      const body = (await response.json()) as { detail?: unknown };

      if (typeof body.detail === "string") {
        message = body.detail;
      } else if (body.detail) {
        message = JSON.stringify(body.detail);
      }
    } catch {
      // Preserve the HTTP status when the response is not JSON.
    }

    throw new Error(message);
  }

  return response.json() as Promise<T>;
}