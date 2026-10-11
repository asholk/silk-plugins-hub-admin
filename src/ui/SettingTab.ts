import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { t } from "../i18n";
import type SilkHubAdmin from "../main";

export class AdminSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: SilkHubAdmin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl, plugin } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName(t("serverUrl"))
      .setDesc(t("serverUrlDesc"))
      .addText((text) =>
        text
          .setPlaceholder("https://hub.example.com")
          .setValue(plugin.settings.serverUrl)
          .onChange(async (value) => {
            plugin.settings.serverUrl = value.trim();
            await plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName(t("account")).setHeading();
    if (plugin.client.signedIn && plugin.settings.username) {
      new Setting(containerEl)
        .setName(t("signedInAs", { name: plugin.settings.username }))
        .setDesc(t("signedInDesc"))
        .addButton((b) =>
          b.setButtonText(t("openPanel")).onClick(() => void plugin.openPanel()),
        )
        .addButton((b) =>
          b.setButtonText(t("signOut")).onClick(async () => {
            await plugin.signOut();
            this.display();
          }),
        );
      return;
    }

    let username = "";
    let password = "";
    const submit = async (): Promise<void> => {
      if (!plugin.client.serverUrl) return void new Notice(t("noServer"));
      try {
        await plugin.signIn(username.trim(), password);
        this.display();
      } catch (err) {
        new Notice(t("signInFailed", { error: (err as Error).message }));
      }
    };
    const onEnter = (el: HTMLInputElement): void =>
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter") void submit();
      });

    new Setting(containerEl).setName(t("username")).addText((text) => {
      text.onChange((v) => (username = v));
      text.inputEl.autocomplete = "username";
      onEnter(text.inputEl);
    });
    new Setting(containerEl).setName(t("password")).addText((text) => {
      text.inputEl.type = "password";
      text.inputEl.autocomplete = "current-password";
      text.onChange((v) => (password = v));
      onEnter(text.inputEl);
    });
    new Setting(containerEl)
      .setDesc(t("signInDesc"))
      .addButton((b) => b.setButtonText(t("signIn")).setCta().onClick(() => void submit()));
  }
}
