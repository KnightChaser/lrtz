import { useEffect, useRef, useState } from "react";

import { api, idleStatus } from "./api";
import type { DownloadRequest, DownloadStatus } from "./api";

export function useDownload() {
  const [status, setStatus] = useState(idleStatus);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = generation.current;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const next = await api<DownloadStatus>("/status", {
          signal: controller.signal,
        });

        if (generation.current === version) {
          setStatus(next);
        }
      } catch (cause) {
        if (!controller.signal.aborted && generation.current === version) {
          setError(
            cause instanceof Error ? cause.message : "Status request failed.",
          );
        }
      } finally {
        if (!controller.signal.aborted) {
          timer = setTimeout(poll, 1000);
        }
      }
    }

    void poll();

    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [revision]);

  async function start(payload: DownloadRequest) {
    generation.current += 1;
    setStarting(true);
    setError(null);

    try {
      const next = await api<DownloadStatus>("/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setStatus(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Download request failed.",
      );
    } finally {
      setStarting(false);
      setRevision((value) => value + 1);
    }
  }

  return {
    status,
    error,
    start,
    busy: starting || status.status === "running",
    dismissError: () => setError(null),
  };
}