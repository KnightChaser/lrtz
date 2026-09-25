import { useEffect, useState } from "react";
import { Alert, Button, Checkbox, Group, Select, Text } from "@mantine/core";

import { api } from "./api";
import { ResultChart } from "./ResultChart";
import { STRATEGY_COLORS } from "./resultsTypes";
import { useResultsData } from "./useResultsData";
import "./ResultsPanel.css";

export function ResultsPanel() {
  const [files, setFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);

  const {
    result,
    infos,
    strategies,
    enabled,
    loading,
    error,
    setStrategyEnabled,
  } = useResultsData(selectedFile, revision);

  useEffect(() => {
    const controller = new AbortController();

    async function refreshFiles() {
      try {
        setFileError(null);
        const response = await api<{ files: string[] }>("/results", {
          signal: controller.signal,
        });

        setFiles(response.files);
        setSelectedFile((current) =>
          current && response.files.includes(current)
            ? current
            : (response.files[0] ?? null),
        );
      } catch (cause) {
        if (!controller.signal.aborted) {
          setFileError(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }

    void refreshFiles();
    return () => controller.abort();
  }, [revision]);

  return (
    <section className="results-panel">
      <Group justify="space-between" align="end" mb="lg">
        <Select
          label="RESULT FILE"
          placeholder="Select a CSV"
          searchable
          data={files}
          value={selectedFile}
          onChange={setSelectedFile}
          className="results-file-select"
        />
        <Button variant="light" onClick={() => setRevision((value) => value + 1)}>
          Refresh files
        </Button>
      </Group>

      {(fileError || error) && (
        <Alert color="red" mb="md">
          {fileError || error}
        </Alert>
      )}
      {!loading && files.length === 0 && (
        <Text c="dimmed">No CSV files found in result/.</Text>
      )}
      {loading && <Text c="dimmed">Loading chart and strategies...</Text>}

      {result && !loading && (
        <>
          <Text size="xs" c="dimmed" mb="sm">
            {result.filename} · {result.bars.length.toLocaleString()} candles
          </Text>

          <div className="results-strategies">
            <Text size="xs" fw={700}>
              STRATEGY OVERLAYS
            </Text>
            {infos.length > 0 ? (
              <Group gap="lg" mt="xs">
                {infos.map((info, index) => (
                  <Checkbox
                    key={info.id}
                    label={`${info.name} · ${info.returnPct.toFixed(2)}% · ${info.completedTrades} trades`}
                    color="cyan"
                    checked={enabled.includes(info.id)}
                    styles={{
                      label: { color: STRATEGY_COLORS[index % STRATEGY_COLORS.length] },
                    }}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setStrategyEnabled(info.id, checked);
                    }}
                  />
                ))}
              </Group>
            ) : (
              <Text c="dimmed" size="xs" mt="xs">
                No matching backtests. Add backtest/&lt;strategy&gt;/ files.
              </Text>
            )}
            {infos.length > 0 && (
              <Text c="dimmed" size="xs" mt="xs">
                Returns include each strategy&apos;s configured fees and slippage;
                hover an exit candle for net trade details.
              </Text>
            )}
          </div>

          {result.bars.length > 0 && (
            <ResultChart
              result={result}
              infos={infos}
              strategies={strategies}
              enabled={enabled}
            />
          )}
        </>
      )}
    </section>
  );
}
