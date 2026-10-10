const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Resolve the backend WebSocket base URL in the browser.
 *
 * When no Public URL is set, the server hands over the Internal URL, usually
 * ws://localhost:8080/v1. That only works for a browser on the server itself;
 * any other browser would dial its own machine. In that case derive the
 * address from the page the user actually opened:
 *   - page on a default port (http://host, https://host) → behind a reverse
 *     proxy such as the bundled Nginx config, so use the page's own origin;
 *   - page on an explicit port (http://host:3000) → frontend reached directly,
 *     so use the page's host with the backend's port.
 */
export function resolveWsBaseUrl(wsBaseUrl: string): string {
  const configured = new URL(wsBaseUrl);
  const page = window.location;
  if (!LOOPBACK_HOSTS.has(configured.hostname) || LOOPBACK_HOSTS.has(page.hostname)) {
    return wsBaseUrl;
  }
  if (page.port === "") {
    const protocol = page.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${page.host}${configured.pathname}`;
  }
  configured.hostname = page.hostname;
  return configured.toString().replace(/\/$/, "");
}
