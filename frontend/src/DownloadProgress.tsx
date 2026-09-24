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
    <Paper withBorder radius="md" p="xl" aria-live="polite">
      <Stack gap="md">
        <Title order={3}>{titles[status.status]}</Title>

        <Progress
          value={status.progress}
          animated={status.status === "running"}
          color={status.status === "failed" ? "red" : "blue"}
          aria-label="Download progress"
        />

        <Group gap="xl">
          <Text size="sm" c="dimmed">
            {status.progress}% of requested time range scanned
          </Text>
          <Text size="sm" c="dimmed">
            {status.candles.toLocaleString()} candles
          </Text>
          <Text size="sm" c="dimmed">
            {status.requests} pages received
          </Text>
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
          >
            Download a browser copy
          </Anchor>
        )}
      </Stack>
    </Paper>
  );
}