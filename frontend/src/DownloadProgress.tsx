import {
  Anchor,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  Title,
} from "@mantine/core";

import type { DownloadStatus } from "./api";

interface Props {
  status: DownloadStatus;
}

const titles = {
  idle: "Ready",
  running: "Downloading",
  completed: "Completed",
  failed: "Download failed",
};

export function DownloadProgress({ status }: Props) {
  return (
    <Paper className="workspace-panel progress-panel" p={{ base: "lg", sm: "xl" }}>
      <Stack gap="md">
        <Group justify="space-between" align="center">
          <div>
            <Text className="panel-kicker">TRANSFER STATUS</Text>
            <Title order={3} mt={7}>
              {titles[status.status]}
            </Title>
          </div>

          <Text
            className={`state-pill state-pill--${status.status}`}
          >
            <span className="state-pill-light" />
            {status.status.toUpperCase()}
          </Text>
        </Group>

        <Progress
          value={status.progress}
          animated={status.status === "running"}
          color={status.status === "failed" ? "red" : "cyan"}
          size="sm"
          radius="xs"
          aria-label="Download progress"
        />

        <Group gap="xl" className="metrics">
          <div>
            <Text className="metric-label">TIME SCANNED</Text>
            <Text className="metric-value">{status.progress}%</Text>
          </div>

          <div>
            <Text className="metric-label">CANDLES</Text>
            <Text className="metric-value">
              {status.candles.toLocaleString()}
            </Text>
          </div>

          <div>
            <Text className="metric-label">PAGES</Text>
            <Text className="metric-value">{status.requests}</Text>
          </div>
        </Group>

        <Text
          size="sm"
          c={status.status === "failed" ? "red" : "dimmed"}
          className="file-message"
        >
          {status.message}
        </Text>

        {status.file && (
          <Anchor
            href={`/api/files/${encodeURIComponent(status.file)}`}
            size="sm"
            className="file-link"
          >
            DOWNLOAD BROWSER COPY ↗
          </Anchor>
        )}
      </Stack>
    </Paper>
  );
}