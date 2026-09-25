import { useEffect, useState } from "react";

import { api } from "./api";
import type { ResultData, StrategyData, StrategyInfo } from "./resultsTypes";

interface StrategyCatalog {
  strategies: StrategyInfo[];
}

function matchesCandles(strategy: StrategyData, result: ResultData): boolean {
  return (
    strategy.equity.length === result.bars.length &&
    strategy.equity.every((point, index) => point.time === result.bars[index].time)
  );
}

/** Load source candles and only backtests sharing their exact time axis. */
export function useResultsData(selectedFile: string | null, revision: number) {
  const [result, setResult] = useState<ResultData | null>(null);
  const [infos, setInfos] = useState<StrategyInfo[]>([]);
  const [strategies, setStrategies] = useState<Record<string, StrategyData>>({});
  const [enabled, setEnabled] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setInfos([]);
    setStrategies({});
    setEnabled([]);
    setError(null);

    if (!selectedFile) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    const query = encodeURIComponent(selectedFile);
    setLoading(true);

    async function load() {
      try {
        const [source, catalog] = await Promise.all([
          api<ResultData>(`/results/${query}?limit=10000`, {
            signal: controller.signal,
          }),
          api<StrategyCatalog>(`/strategies?result=${query}`, {
            signal: controller.signal,
          }),
        ]);

        const responses = await Promise.allSettled(
          catalog.strategies.map((info) =>
            api<StrategyData>(
              `/strategies/${encodeURIComponent(info.id)}?result=${query}`,
              { signal: controller.signal },
            ),
          ),
        );

        if (controller.signal.aborted) return;

        const validInfos: StrategyInfo[] = [];
        const validStrategies: Record<string, StrategyData> = {};
        const invalidIds: string[] = [];

        responses.forEach((response, index) => {
          const info = catalog.strategies[index];

          if (
            response.status === "fulfilled" &&
            matchesCandles(response.value, source)
          ) {
            validInfos.push(info);
            validStrategies[info.id] = response.value;
          } else {
            invalidIds.push(info.id);
          }
        });

        setResult(source);
        setInfos(validInfos);
        setStrategies(validStrategies);
        setEnabled(validInfos.map((info) => info.id));

        if (invalidIds.length > 0) {
          setError(
            `Strategy data did not match these candles: ${invalidIds.join(", ")}`,
          );
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [selectedFile, revision]);

  function setStrategyEnabled(id: string, checked: boolean) {
    // Read the checkbox value before scheduling a state update. React may
    // clear event.currentTarget by the time the update callback runs.
    setEnabled((current) =>
      checked
        ? current.includes(id)
          ? current
          : [...current, id]
        : current.filter((currentId) => currentId !== id),
    );
  }

  return {
    result,
    infos,
    strategies,
    enabled,
    loading,
    error,
    setStrategyEnabled,
  };
}
