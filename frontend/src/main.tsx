import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";

import "@mantine/core/styles.css";
import "./styles.css";

import App from "./App";

const theme = createTheme({
  fontFamily: '"Geist Mono", monospace',
  headings: {
    fontFamily: '"Geist Mono", monospace',
  },
  primaryColor: "cyan",
  defaultRadius: "sm",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);