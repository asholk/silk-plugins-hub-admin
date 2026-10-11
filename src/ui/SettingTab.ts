import { App, Notice, PluginSettingTab, SettingDefinitionItem, SettingGroupItem } from "obsidian";
import { t } from "../i18n";
import type SilkHubAdmin from "../main";

/**
 * Settings declared with getSettingDefinitions(): they appear in Obsidian's settings search and
 * redraw with update() after signing in or out.
 */
export class AdminSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SilkHubAdmin,
  ) {
    super(app, plugin);
  }

  getControlValue(key: string): unknown {
    return key === "serverUrl" ? this.plugin.settings.serverUrl : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "serverUrl") return;
    this.plugin.settings.serverUrl = String(value).trim();
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const { plugin } = this;
    const signedIn = plugin.client.signedIn && !!plugin.settings.username;
    return [
      {
        name: t("serverUrl"),
        desc: t("serverUrlDesc"),
        control: { type: "text", key: "serverUrl", placeholder: "https://hub.example.com" },
      },
      { type: "group", heading: t("account"), items: signedIn ? this.signedInItems() : this.signInItems() },
    ];
  }

  private signedInItems(): SettingGroupItem[] {
    const { plugin } = this;
    return [
      {
        name: t("signedInAs", { name: plugin.settings.username ?? "" }),
        desc: t("signedInDesc"),
        aliases: [t("openPanel"), t("signOut")],
        render: (s) => {
          s.addButton((b) => b.setButtonText(t("openPanel")).onClick(() => void plugin.openPanel())).addButton((b) =>
            b.setButtonText(t("signOut")).onClick(async () => {
              await plugin.signOut();
              this.update();
            }),
          );
        },
      },
      {
        name: t("changePassword"),
        desc: t("changePasswordDesc"),
        render: (s) => {
          s.addButton((b) => b.setButtonText(t("changePassword")).onClick(() => plugin.openChangePassword()));
        },
      },
    ];
  }

  /** Login and password fields aren't controls: the password must never be saved to the plugin data. */
  private signInItems(): SettingGroupItem[] {
    const { plugin } = this;
    let username = "";
    let password = "";
    const submit = async (): Promise<void> => {
      if (!plugin.client.serverUrl) return void new Notice(t("noServer"));
      try {
        await plugin.signIn(username.trim(), password);
        this.update();
      } catch (err) {
        new Notice(t("signInFailed", { error: (err as Error).message }));
      }
    };
    const onEnter = (el: HTMLInputElement): void =>
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });
    return [
      {
        name: t("username"),
        render: (s) => {
          s.addText((text) => {
            text.onChange((v) => (username = v));
            text.inputEl.autocomplete = "username";
            onEnter(text.inputEl);
          });
        },
      },
      {
        name: t("password"),
        searchable: false,
        render: (s) => {
          s.addText((text) => {
            text.inputEl.type = "password";
            text.inputEl.autocomplete = "current-password";
            text.onChange((v) => (password = v));
            onEnter(text.inputEl);
          });
        },
      },
      {
        name: t("signIn"),
        desc: t("signInDesc"),
        render: (s) => {
          s.addButton((b) => b.setButtonText(t("signIn")).setCta().onClick(() => void submit()));
        },
      },
    ];
  }
}
