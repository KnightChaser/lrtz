import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  Autocomplete,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";

import { api } from "./api";
import type { DownloadRequest, Market, Period } from "./api";

interface Props {
  busy: boolean;
  onStart: (payload: DownloadRequest) => Promise<void>;
}

function kstInput(date: Date): string {
  return new Date(date.getTime() + 9 * 3600000)
    .toISOString()
    .slice(0, 16);
}

const intervals = [
  ["1", "1 minute"],
  ["3", "3 minutes"],
  ["5", "5 minutes"],
  ["10", "10 minutes"],
  ["15", "15 minutes"],
  ["30", "30 minutes"],
  ["60", "1 hour"],
  ["120", "2 hours — aggregated"],
  ["240", "4 hours"],
].map(([value, label]) => ({ value, label }));

export function DownloadForm({ busy, onStart }: Props) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [market, setMarket] = useState("KRW-BTC");
  const [minutes, setMinutes] = useState("60");
  const [period, setPeriod] = useState<Period>("year");
  const [start, setStart] = useState(() =>
    kstInput(new Date(Date.now() - 365 * 86400000)),
  );
  const [end, setEnd] = useState(() => kstInput(new Date()));
  const [marketError, setMarketError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    api<Market[]>("/markets", { signal: controller.signal })
      .then(setMarkets)
      .catch(() => {
        if (!controller.signal.aborted) setMarketError(true);
      });

    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const payload: DownloadRequest = {
      market: market.trim().toUpperCase(),
      minutes: Number(minutes),
      period,
    };

    if (period === "custom") {
      payload.start = `${start}:00+09:00`;
      payload.end = `${end}:00+09:00`;
    }

    await onStart(payload);
  }

  const selected = markets.find((item) => item.market === market);

  return (
    <Paper className="workspace-panel" p={{ base: "lg", sm: "xl" }}>
      <Stack gap="xl">
        <Group justify="space-between" align="start" gap="md">
          <div>
            <Text className="panel-kicker">MODULE 02 / DATA INTAKE</Text>
            <Title order={2} className="panel-title" mt={8}>
              Historical candles
            </Title>
            <Text className="panel-description" mt="xs">
              Retrieve complete Upbit OHLCV candles for local analysis.
            </Text>
          </div>

          <Text className="panel-tag">UPBIT · PUBLIC API</Text>
        </Group>

        <form onSubmit={(event) => void submit(event)}>
          <Stack gap="lg">
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
              <Autocomplete
                label="MARKET"
                value={market}
                onChange={setMarket}
                data={markets.map((item) => ({
                  value: item.market,
                  label: `${item.name} · ${item.market}`,
                }))}
                description={
                  marketError
                    ? "Market list unavailable. Enter an Upbit code."
                    : selected
                      ? `${selected.name} · ${selected.market}`
                      : "Enter an Upbit market code."
                }
                required
                disabled={busy}
                limit={40}
              />

              <Select
                label="INTERVAL"
                data={intervals}
                value={minutes}
                onChange={(value) => setMinutes(value ?? "60")}
                allowDeselect={false}
                disabled={busy}
              />

              <Select
                label="PERIOD"
                data={[
                  { value: "month", label: "Last 30 days" },
                  { value: "year", label: "Last year" },
                  { value: "custom", label: "Custom range" },
                ]}
                value={period}
                onChange={(value) => setPeriod((value ?? "year") as Period)}
                allowDeselect={false}
                disabled={busy}
              />
            </SimpleGrid>

            {period === "custom" && (
              <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="lg">
                <TextInput
                  type="datetime-local"
                  label="START / KST"
                  value={start}
                  onChange={(event) => setStart(event.currentTarget.value)}
                  required
                  disabled={busy}
                />

                <TextInput
                  type="datetime-local"
                  label="END / KST"
                  value={end}
                  onChange={(event) => setEnd(event.currentTarget.value)}
                  required
                  disabled={busy}
                />
              </SimpleGrid>
            )}

            <div className="form-bottom">
              <Text size="xs" c="dimmed" className="form-note">
                Complete candles only. Two-hour intervals follow KST
                midnight boundaries.
              </Text>

              <Button
                type="submit"
                loading={busy}
                className="download-button"
              >
                {busy ? "ACQUIRING DATA" : "DOWNLOAD CSV  ↗"}
              </Button>
            </div>
          </Stack>
        </form>
      </Stack>
    </Paper>
  );
}