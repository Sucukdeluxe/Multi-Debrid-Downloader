import type { AppSettings } from "../shared/types";
import type { NetworkProxyState } from "./network-proxy";

export type ProxyOnlyAccountErrorCode =
  | "proxy_list_missing"
  | "proxy_list_unreadable"
  | "proxy_list_empty"
  | "proxy_index_unavailable"
  | "proxy_unreachable";

export const PROXY_ONLY_ACCOUNT_ERROR_PREFIX = "proxy_only_account:";

const TRANSPORT_FAILURE_PATTERN = /proxy|fetch failed|network|econn|enotfound|eai_again|etimedout|und_err|socket hang up|err_proxy|tunneling socket|timeout|aborted due to timeout|HTTP 407|connection (?:closed|refused|reset|timed out)/i;

export function resolveProxyOnlyAccountErrorCode(
  settings: Pick<AppSettings, "proxyDownloadEnabled" | "proxyListPath">,
  state: NetworkProxyState,
  failureText = ""
): ProxyOnlyAccountErrorCode | null {
  if (!settings.proxyDownloadEnabled || state.status === "disabled") return null;
  if (state.status === "blocked") {
    if (state.reason === "proxy_file_unavailable") {
      return settings.proxyListPath.trim() ? "proxy_list_unreadable" : "proxy_list_missing";
    }
    if (state.reason === "no_valid_proxies") return "proxy_list_empty";
    return "proxy_index_unavailable";
  }
  return TRANSPORT_FAILURE_PATTERN.test(failureText) ? "proxy_unreachable" : null;
}

export function createProxyOnlyAccountError(code: ProxyOnlyAccountErrorCode): Error {
  return new Error(`${PROXY_ONLY_ACCOUNT_ERROR_PREFIX}${code}`);
}
