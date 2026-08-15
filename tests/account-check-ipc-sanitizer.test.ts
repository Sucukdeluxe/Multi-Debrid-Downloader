import { afterEach, describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";
import { defaultSettings } from "../src/main/constants";
import { parseDebridLinkApiKeys } from "../src/shared/debrid-link-keys";
import type { AppSettings, DebridAccountStatus } from "../src/shared/types";

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\MDD\\Test" },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: {},
  Tray: class {}
}));

function mockFetchOnce(status: number, body: unknown): void {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  })) as unknown as typeof fetch);
}

function createController(settings: AppSettings): AppController {
  const controller = Object.create(AppController.prototype) as {
    settings: AppSettings;
    manager: { applyDebridAccountStatuses: ReturnType<typeof vi.fn> };
    audit: ReturnType<typeof vi.fn>;
  };
  controller.settings = settings;
  controller.manager = { applyDebridAccountStatuses: vi.fn() };
  controller.audit = vi.fn();
  return controller as unknown as AppController;
}

function expectNoSecret(payload: unknown, secrets: readonly string[]): void {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("account-check IPC result sanitizing", () => {
  it("sanitizes bulk check statuses before returning or persisting them", async () => {
    const login = "bulk-status@example.test";
    const secret = "bulk raw secret+ä?=1";
    const encodedSecret = encodeURIComponent(secret);
    const credentialLine = `${login}:${secret}`;
    const settings = {
      ...defaultSettings(),
      megaCredentials: credentialLine,
      megaDebridApiCredentials: credentialLine,
      megaDebridApiEnabled: true
    };
    const providerText = `Denied https://www.mega-debrid.eu/api.php?action=connectUser&login=${encodeURIComponent(login)}&password=${encodedSecret} Authorization: Bearer ${encodedSecret} raw ${secret} line ${credentialLine}`;
    mockFetchOnce(200, { response_code: "error", response_text: providerText });
    const controller = createController(settings);

    const statuses = await controller.checkDebridAccounts();

    expectNoSecret(statuses, [secret, encodedSecret, credentialLine]);
    expectNoSecret((controller as unknown as { manager: { applyDebridAccountStatuses: ReturnType<typeof vi.fn> } }).manager.applyDebridAccountStatuses.mock.calls, [secret, encodedSecret, credentialLine]);
    expect(statuses[0]?.message).toContain("[geschützt]");
  });

  it("sanitizes single credential checks with raw, encoded, header and query echoes", async () => {
    const secret = "single raw token+ö?=2";
    const encodedSecret = encodeURIComponent(secret);
    const echoedHeaderSecret = "provider-header-token-95K";
    const echoedPassphrase = "provider-backup-passphrase-54A";
    const providerText = `Rejected https://debrid-link.com/api/v2/account/infos?access_token=${encodedSecret}&apiKey=${secret} Authorization: Bearer ${encodedSecret} Cookie: sid=${secret} X-Api-Key: ${echoedHeaderSecret}
Backup-Passphrase=${echoedPassphrase}`;
    mockFetchOnce(200, { success: false, error: providerText });
    const controller = createController(defaultSettings());

    const status = await controller.checkAccountCredentials({
      kind: "debridlink-api",
      secret
    });

    expectNoSecret(status, [secret, encodedSecret, echoedHeaderSecret, echoedPassphrase]);
    expect((status as DebridAccountStatus).message).toContain("[geschützt]");
  });

  it("persists a direct status refresh for an existing account", async () => {
    const settings = defaultSettings();
    settings.debridLinkApiKeys = "existing-account-token";
    const accountId = parseDebridLinkApiKeys(settings.debridLinkApiKeys)[0].id;
    mockFetchOnce(200, { success: true, value: { username: "active-user", accountType: 1 } });
    const controller = createController(settings);

    const status = await controller.checkAccountCredentials({ kind: "debridlink-api", accountId });

    expect(status).toEqual(expect.objectContaining({ accountId, valid: true, username: "active-user" }));
    expect((controller as unknown as { manager: { applyDebridAccountStatuses: ReturnType<typeof vi.fn> } }).manager.applyDebridAccountStatuses)
      .toHaveBeenCalledWith([expect.objectContaining({ accountId, valid: true })]);
  });
});
