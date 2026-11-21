import { contextBridge, ipcRenderer } from "electron";
import { createCaretApi } from "./caret-api";

contextBridge.exposeInMainWorld("caret", createCaretApi(ipcRenderer));
