import {
  Alert,
  Box,
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
import { ResultsPanel } from "./ResultsPanel";
import { useDownload } from "./useDownload";

export default function App() {
  const download = useDownload();

  return (
    <Box className="app-shell">
      <Container size="lg" py={36}>
        <Stack gap={30}>
          <header className="app-header">
            <Group justify="space-between" align="center" gap="md">
              <div>
                <Text className="eyebrow">MARKET RESEARCH / WORKSPACE</Text>
                <Group align="baseline" gap="md" mt={6}>
                  <Title order={1} className="brand">
                    lrtz<span className="brand-dot">.</span>
                  </Title>
                  <Text className="brand-subtitle">
                    Research Workspace
                  </Text>
                </Group>
              </div>

              <Text className="header-status">
                <span className="status-light" />
                LOCAL SESSION
              </Text>
            </Group>
          </header>

          <Tabs
            defaultValue="download"
            keepMounted
            classNames={{
              root: "workspace-tabs",
              list: "workspace-tab-list",
              tab: "workspace-tab",
            }}
          >
            <Tabs.List mb={24}>
              <Tabs.Tab value="results">01 / RESULTS</Tabs.Tab>
              <Tabs.Tab value="download">02 / DOWNLOAD</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="results">
              <Paper className="workspace-panel">
                <Text className="panel-kicker">MODULE 01</Text>
                <Title order={2} mt="sm" mb="lg">
                  Results
                </Title>
                <ResultsPanel />
              </Paper>
            </Tabs.Panel>


            <Tabs.Panel value="download">
              <Stack gap={18}>
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

          <footer className="app-footer">
            <span>LRTZ / LOCAL RESEARCH ENVIRONMENT</span>
            <span>UPBIT OHLCV DATA</span>
          </footer>
        </Stack>
      </Container>
    </Box>
  );
}