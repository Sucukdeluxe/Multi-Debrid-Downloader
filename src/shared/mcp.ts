export const MCP_SCOPES = ["read", "control", "files", "transfer", "secrets", "updates", "extraction", "full_access"] as const;
export type McpScope = typeof MCP_SCOPES[number];

export function effectiveMcpScopes(scopes: readonly McpScope[]): McpScope[] {
  return scopes.includes("full_access") ? [...MCP_SCOPES] : [...scopes];
}

export interface McpConfiguration {
  enabled: boolean;
  relayUrl: string;
  name: string;
  scopes: McpScope[];
  extraRoots: string[];
}

export interface McpStatus extends McpConfiguration {
  connection: "disabled" | "connecting" | "online" | "offline" | "blocked";
  installationId: string | null;
  activeRequests: number;
  lastContactAt: number | null;
  error: string | null;
  toolCount: number;
}

export interface McpCredentials {
  installationId: string;
  agentToken: string;
  clientToken: string;
  relayUrl: string;
}

export interface McpRelayCommand {
  requestId: string;
  sessionId: string;
  deadline: number;
  principal: { id: string; installationId: string; role: "client" };
  message: Record<string, unknown>;
}
