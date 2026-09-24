import {
  Alert,
  Container,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  Title,
} from "@mantine/core";

import { DownloadForm } from "./DownloadForm";
import { DownloadProgress } from "./DownloadProgress";
import { useDownload } from "./useDownload";

export default function App() {
  const download = useDownload();

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        <Group align="baseline">
          <Title order={1}>lrtz</Title>
          <Text c="dimmed">Research Workspace</Text>
        </Group>

        <Tabs defaultValue="download" keepMounted>
          <Tabs.List mb="xl">
            <Tabs.Tab value="results">Results</Tabs.Tab>
            <Tabs.Tab value="download">Download</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="results">
            <Paper withBorder radius="md" p="xl">
              <Title order={3}>Results</Title>
              <Text c="dimmed" mt="sm">
                Backtest charts will appear here in a future update.
              </Text>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="download">
            <Stack gap="lg">
              {download.error && (
                <Alert
                  color="red"
                  title="Request error"
                  withCloseButton
                  onClose={download.dismissError}
                >
                  {download.error}
                </Alert>
              )}

              <DownloadForm
                busy={download.busy}
                onStart={download.start}
              />
              <DownloadProgress status={download.status} />
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  );
}