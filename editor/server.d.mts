export interface RunningEditorServer {
  origin: string;
  token: string;
  close(): Promise<void>;
}

export function startEditorServer(options: {
  root: string;
  token?: string;
  port?: number;
  withVite?: boolean;
}): Promise<RunningEditorServer>;
