import React from "react";
import ReactDOM from "react-dom/client";
import { createTheme, MantineProvider } from "@mantine/core";

import "@mantine/core/styles.css";
import "./styles.css";

import App from "./App";

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: "Inter, system-ui, sans-serif",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
);