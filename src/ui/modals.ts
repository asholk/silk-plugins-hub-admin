import { App, ButtonComponent, Component, MarkdownRenderer, Modal, Notice, Setting } from "obsidian";
import { t } from "../i18n";

/** Asks to confirm a destructive action; resolves true on confirm. */
export function confirmAction(app: App, title: string, message: string, confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const modal = new Modal(app);
    modal.setTitle(title);
    modal.contentEl.createEl("p", { text: message });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText(t("cancel")).onClick(() => modal.close()))
      .addButton((b) =>
        b
          .setButtonText(confirmText)
          .setDestructive()
          .onClick(() => {
            confirmed = true;
            modal.close();
          }),
      );
    modal.onClose = () => resolve(confirmed);
    modal.open();
  });
}

export interface FormField {
  key: string;
  name: string;
  desc?: string;
  placeholder?: string;
  multiline?: boolean;
  password?: boolean;
  required?: boolean;
}

/**
 * A modal form. `submit` gets the trimmed values; when it throws, the error is shown and the form stays open.
 */
export class FormModal extends Modal {
  private values: Record<string, string> = {};

  constructor(
    app: App,
    title: string,
    private fields: FormField[],
    private submitText: string,
    private submit: (values: Record<string, string>) => Promise<void>,
  ) {
    super(app);
    this.setTitle(title);
  }

  onOpen(): void {
    const { contentEl } = this;
    let first: HTMLElement | null = null;
    for (const field of this.fields) {
      const setting = new Setting(contentEl).setName(field.name);
      if (field.desc) setting.setDesc(field.desc);
      const onChange = (v: string): void => {
        // Passwords are kept exactly as typed.
        this.values[field.key] = field.password ? v : v.trim();
      };
      if (field.multiline) {
        setting.addTextArea((text) => {
          text.setPlaceholder(field.placeholder ?? "").onChange(onChange);
          text.inputEl.rows = 3;
          first ??= text.inputEl;
        });
      } else {
        setting.addText((text) => {
          text.setPlaceholder(field.placeholder ?? "").onChange(onChange);
          if (field.password) text.inputEl.type = "password";
          text.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") void this.trySubmit(button);
          });
          first ??= text.inputEl;
        });
      }
    }
    let button!: ButtonComponent;
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton((b) => {
        button = b.setButtonText(this.submitText).setCta().onClick(() => void this.trySubmit(button));
      });
    (first as HTMLElement | null)?.focus();
  }

  private async trySubmit(button: ButtonComponent): Promise<void> {
    const missing = this.fields.some((f) => f.required && !this.values[f.key]);
    if (missing) return;
    button.setDisabled(true);
    try {
      await this.submit({ ...this.values });
      this.close();
    } catch (err) {
      new Notice(t("failed", { error: (err as Error).message }));
      button.setDisabled(false);
    }
  }
}

/** Shows a fresh publish token once, with copy buttons for it and the Hub address. */
export class TokenModal extends Modal {
  constructor(
    app: App,
    private pluginName: string,
    private token: string,
    private hubUrl: string,
  ) {
    super(app);
    this.setTitle(t("tokenTitle", { name: pluginName }));
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { text: t("tokenOnce") });
    this.copyRow("HUB_PUBLISH_TOKEN", this.token);
    this.copyRow("HUB_URL", this.hubUrl);
    new Setting(contentEl).addButton((b) => b.setButtonText(t("done")).setCta().onClick(() => this.close()));
  }

  private copyRow(name: string, value: string): void {
    new Setting(this.contentEl)
      .setName(name)
      .addText((text) => {
        text.setValue(value).setDisabled(true);
        text.inputEl.addClass("silk-admin-secret");
      })
      .addExtraButton((b) =>
        b
          .setIcon("copy")
          .setTooltip(t("copy"))
          .onClick(async () => {
            await navigator.clipboard.writeText(value);
            new Notice(t("copied"));
          }),
      );
  }
}

/** Renders a card or guide Markdown in a modal. */
export class MarkdownModal extends Modal {
  private component = new Component();

  constructor(
    app: App,
    title: string,
    private markdown: string,
  ) {
    super(app);
    this.setTitle(title);
    this.modalEl.addClass("silk-admin-doc-modal");
  }

  onOpen(): void {
    this.component.load();
    const el = this.contentEl.createDiv({ cls: "markdown-rendered silk-admin-doc" });
    void MarkdownRenderer.render(this.app, this.markdown, el, "", this.component);
  }

  onClose(): void {
    this.component.unload();
    this.contentEl.empty();
  }
}

/** Toggles of companies a user belongs to; `save` gets the chosen ids. */
export class UserCompaniesModal extends Modal {
  private chosen: Set<number>;

  constructor(
    app: App,
    email: string,
    private companies: { id: number; name: string }[],
    current: number[],
    private save: (ids: number[]) => Promise<void>,
  ) {
    super(app);
    this.chosen = new Set(current);
    this.setTitle(email);
  }

  onOpen(): void {
    const { contentEl } = this;
    for (const c of this.companies) {
      new Setting(contentEl).setName(c.name).addToggle((toggle) =>
        toggle.setValue(this.chosen.has(c.id)).onChange((on) => {
          if (on) this.chosen.add(c.id);
          else this.chosen.delete(c.id);
        }),
      );
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(t("save"))
          .setCta()
          .onClick(async () => {
            try {
              await this.save([...this.chosen]);
              this.close();
            } catch (err) {
              new Notice(t("failed", { error: (err as Error).message }));
            }
          }),
      );
  }
}

/** Base64 of a file's bytes, in chunks so large files don't overflow the call stack. */
async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * Publishes a release from files the admin picks (desktop or mobile), without CI.
 * `upload` gets the notes and the files; when it throws, the error is shown and the modal stays open.
 */
export class UploadReleaseModal extends Modal {
  private files: File[] = [];
  private notes = "";

  constructor(
    app: App,
    pluginName: string,
    private upload: (notes: string, files: { name: string; data: string }[]) => Promise<void>,
  ) {
    super(app);
    this.setTitle(`${pluginName}: ${t("uploadRelease")}`);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("p", { cls: "silk-admin-muted", text: t("uploadReleaseDesc") });
    const input = contentEl.createEl("input", { attr: { type: "file", multiple: "" } });
    input.hide();
    const picked = new Setting(contentEl).setName(t("releaseFiles")).setDesc(t("noFilesPicked"));
    picked.addButton((b) => b.setButtonText(t("pickFiles")).onClick(() => input.click()));
    input.addEventListener("change", () => {
      this.files = Array.from(input.files ?? []);
      picked.setDesc(this.files.length ? t("filesPicked", { list: this.files.map((f) => f.name).join(", ") }) : t("noFilesPicked"));
    });
    new Setting(contentEl)
      .setName(t("releaseNotes"))
      .setDesc(t("releaseNotesDesc"))
      .addTextArea((text) => {
        text.onChange((v) => (this.notes = v));
        text.inputEl.rows = 4;
      });
    new Setting(contentEl)
      .addButton((b) => b.setButtonText(t("cancel")).onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText(t("upload"))
          .setCta()
          .onClick(async () => {
            if (this.files.length === 0) return void new Notice(t("noFilesPicked"));
            b.setDisabled(true);
            try {
              const files = await Promise.all(this.files.map(async (f) => ({ name: f.name, data: await toBase64(f) })));
              // Each non-empty line becomes a changelog item, with or without a leading dash.
              const items = this.notes
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => (/^[-*•]\s/.test(line) ? line : `- ${line}`));
              await this.upload(items.length ? `Changelog:\n${items.join("\n")}` : "", files);
              this.close();
            } catch (err) {
              new Notice(t("failed", { error: (err as Error).message }));
              b.setDisabled(false);
            }
          }),
      );
  }
}
