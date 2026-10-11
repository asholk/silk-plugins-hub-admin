import { Notice, Plugin } from "obsidian";
import { AdminClient } from "./api/AdminClient";
import { t } from "./i18n";
import { ADMIN_VIEW, AdminView } from "./ui/AdminView";
import { FormModal } from "./ui/modals";
import { AdminSettingTab } from "./ui/SettingTab";

interface AdminSettings {
  serverUrl: string;
  /** Name of the signed-in administrator; the token itself is in SecretStorage. */
  username: string | null;
}

const DEFAULT_SETTINGS: AdminSettings = { serverUrl: "", username: null };

export default class SilkHubAdmin extends Plugin {
  settings!: AdminSettings;
  client!: AdminClient;
  private settingTab!: AdminSettingTab;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, (await this.loadData()) as Partial<AdminSettings> | null);
    this.client = new AdminClient(this.app, () => this.settings.serverUrl, () => this.onSignedOut());

    this.settingTab = new AdminSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerView(ADMIN_VIEW, (leaf) => new AdminView(leaf, this));
    this.addRibbonIcon("shield-check", t("openPanel"), () => void this.openPanel());
    this.addCommand({ id: "open-panel", name: t("openPanel"), callback: () => void this.openPanel() });
    this.addCommand({
      id: "change-password",
      name: t("changePassword"),
      checkCallback: (checking) => {
        if (!this.client.signedIn) return false;
        if (!checking) this.openChangePassword();
        return true;
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async openPanel(): Promise<void> {
    const { workspace } = this.app;
    const leaf = workspace.getLeavesOfType(ADMIN_VIEW)[0] ?? workspace.getLeaf("tab");
    await leaf.setViewState({ type: ADMIN_VIEW, active: true });
    await workspace.revealLeaf(leaf);
  }

  async signIn(username: string, password: string): Promise<void> {
    const name = await this.client.signIn(username, password);
    this.settings.username = name;
    await this.saveSettings();
    new Notice(t("signInDone", { name }));
    this.refreshViews();
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    this.settings.username = null;
    await this.saveSettings();
    this.refreshViews();
  }

  openChangePassword(): void {
    new FormModal(
      this.app,
      t("changePassword"),
      [
        { key: "current", name: t("currentPassword"), required: true, password: true },
        { key: "password", name: t("newPassword"), desc: t("adminPasswordDesc"), required: true, password: true },
      ],
      t("changePassword"),
      async (v) => {
        await this.client.changePassword(v.current, v.password);
        new Notice(t("passwordChanged"));
      },
    ).open();
  }

  openSettings(): void {
    const setting = (this.app as unknown as { setting: { open(): void; openTabById(id: string): void } }).setting;
    setting.open();
    setting.openTabById(this.manifest.id);
  }

  private onSignedOut(): void {
    if (this.settings.username === null) return;
    this.settings.username = null;
    void this.saveSettings();
    new Notice(t("sessionExpired"));
    this.refreshViews();
  }

  /** Redraws the admin panel and the settings tab after signing in or out. */
  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(ADMIN_VIEW)) {
      if (leaf.view instanceof AdminView) void leaf.view.render();
    }
    this.settingTab.update();
  }
}
