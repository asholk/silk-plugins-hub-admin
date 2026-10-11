import { Component, DropdownComponent, ItemView, MarkdownRenderer, Notice, setIcon, Setting, SettingGroup, WorkspaceLeaf } from "obsidian";
import type { Access, PluginRow, Release } from "../api/AdminClient";
import { t, MessageKey } from "../i18n";
import type SilkHubAdmin from "../main";
import { confirmAction, FormModal, MarkdownModal, TokenModal, UploadReleaseModal, UserCompaniesModal } from "./modals";

export const ADMIN_VIEW = "silk-plugins-hub-admin";

type Tab = "companies" | "users" | "plugins" | "admins";
type Route = { tab: "companies"; companyId?: number } | { tab: "users" } | { tab: "plugins"; pluginId?: string } | { tab: "admins" };
type AccessLevel = "none" | "available" | "required";

const TABS: { tab: Tab; label: MessageKey; icon: string }[] = [
  { tab: "companies", label: "companies", icon: "building-2" },
  { tab: "users", label: "users", icon: "users" },
  { tab: "plugins", label: "plugins", icon: "puzzle" },
  { tab: "admins", label: "admins", icon: "user-cog" },
];

const TYPE_LABELS: Record<string, MessageKey> = { new: "typeNew", improved: "typeImproved", fixed: "typeFixed" };

const levelOf = (access: { required: boolean } | undefined): AccessLevel =>
  !access ? "none" : access.required ? "required" : "available";

const formatDate = (iso: string | null): string => (iso ? String(iso).slice(0, 16).replace("T", " ") : "");

const formatSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * The admin panel in a workspace tab: companies, users and plugins of the Hub, each list leading to
 * a detail page. Every change is sent to the server right away.
 */
export class AdminView extends ItemView {
  private route: Route = { tab: "companies" };
  private renderId = 0;
  private docs = new Component();

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: SilkHubAdmin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return ADMIN_VIEW;
  }

  getDisplayText(): string {
    return t("viewTitle");
  }

  getIcon(): string {
    return "shield-check";
  }

  async onOpen(): Promise<void> {
    this.addChild(this.docs);
    await this.render();
  }

  private go(route: Route): void {
    this.route = route;
    void this.render();
  }

  async render(): Promise<void> {
    const id = ++this.renderId;
    const root = this.contentEl;
    root.empty();
    root.addClass("silk-admin");
    // Rendered Markdown of the previous page is released before drawing the next one.
    this.removeChild(this.docs);
    this.docs = this.addChild(new Component());

    const { client } = this.plugin;
    if (!client.signedIn) {
      root.createEl("p", { cls: "silk-admin-muted", text: t("notSignedIn") });
      new Setting(root).addButton((b) => b.setButtonText(t("openSettings")).setCta().onClick(() => this.plugin.openSettings()));
      return;
    }

    this.renderNav(root);
    const body = root.createDiv({ cls: "silk-admin-body" });
    body.createDiv({ cls: "silk-admin-muted", text: t("loading") });
    const content = createDiv();
    try {
      await this.renderRoute(content);
    } catch (err) {
      if (id !== this.renderId) return;
      body.empty();
      body.createEl("p", { cls: "silk-admin-error", text: t("failed", { error: (err as Error).message }) });
      return;
    }
    if (id !== this.renderId) return;
    body.empty();
    body.appendChild(content);
  }

  private renderNav(root: HTMLElement): void {
    const nav = root.createDiv({ cls: "silk-admin-nav" });
    for (const { tab, label, icon } of TABS) {
      const item = nav.createDiv({ cls: "silk-admin-nav-item" });
      item.toggleClass("is-active", this.route.tab === tab);
      setIcon(item.createSpan(), icon);
      item.createSpan({ text: t(label) });
      item.addEventListener("click", () => this.go({ tab }));
    }
    nav.createDiv({ cls: "silk-admin-spacer" });
    const refresh = nav.createDiv({ cls: "clickable-icon", attr: { "aria-label": t("refresh") } });
    setIcon(refresh, "refresh-cw");
    refresh.addEventListener("click", () => void this.render());
  }

  private renderRoute(el: HTMLElement): Promise<void> {
    const r = this.route;
    if (r.tab === "companies") return r.companyId !== undefined ? this.renderCompany(el, r.companyId) : this.renderCompanies(el);
    if (r.tab === "users") return this.renderUsers(el);
    if (r.tab === "admins") return this.renderAdmins(el);
    return r.pluginId !== undefined ? this.renderPlugin(el, r.pluginId) : this.renderPlugins(el);
  }

  /** Runs a change on the server, shows the outcome and redraws the page. */
  private async act(action: () => Promise<unknown>, success?: string): Promise<void> {
    try {
      await action();
      if (success) new Notice(success);
    } catch (err) {
      new Notice(t("failed", { error: (err as Error).message }));
    }
    await this.render();
  }

  private backLink(el: HTMLElement, label: string, route: Route): void {
    const back = el.createDiv({ cls: "silk-admin-back" });
    setIcon(back.createSpan(), "arrow-left");
    back.createSpan({ text: label });
    back.addEventListener("click", () => this.go(route));
  }

  /** A list of rows with a search box when it's long; each row opens on click. */
  private listGroup(el: HTMLElement, heading: string, addLabel: string | null, onAdd: (() => void) | null): {
    group: SettingGroup;
    row: (setting: Setting, searchText: string, open?: () => void) => void;
  } {
    const rows: { el: HTMLElement; text: string }[] = [];
    const group = new SettingGroup(el).setHeading(heading);
    group.addSearch((search) =>
      search.setPlaceholder(t("search")).onChange((value) => {
        const q = value.toLowerCase().trim();
        for (const r of rows) r.el.toggle(q === "" || r.text.includes(q));
      }),
    );
    if (addLabel && onAdd) group.addExtraButton((b) => b.setIcon("plus").setTooltip(addLabel).onClick(onAdd));
    const row = (setting: Setting, searchText: string, open?: () => void): void => {
      rows.push({ el: setting.settingEl, text: searchText.toLowerCase() });
      if (!open) return;
      setting.settingEl.addClass("silk-admin-row");
      setting.addExtraButton((b) => b.setIcon("chevron-right").onClick(open));
      setting.settingEl.addEventListener("click", (e) => {
        if (!(e.target as HTMLElement).closest("button, input, select, .clickable-icon")) open();
      });
    };
    return { group, row };
  }

  private accessDropdown(setting: Setting, level: AccessLevel, onChange: (level: AccessLevel) => void): void {
    setting.addDropdown((d: DropdownComponent) =>
      d
        .addOptions({ none: t("accessNone"), available: t("accessAvailable"), required: t("accessRequired") })
        .setValue(level)
        .onChange((v) => onChange(v as AccessLevel)),
    );
  }

  // ---------- Companies ----------

  private async renderCompanies(el: HTMLElement): Promise<void> {
    const { client } = this.plugin;
    const [companies, plugins] = await Promise.all([client.companies(), client.plugins()]);
    const { group, row } = this.listGroup(el, t("companies"), t("newCompany"), () => this.createCompany());
    if (companies.length === 0) group.addSetting((s) => void s.setDesc(t("noCompanies")));
    const pluginNames = new Map(plugins.map((p) => [p.id, p.name]));
    for (const c of companies) {
      group.addSetting((s) => {
        s.setName(c.name).setDesc(t("companySummary", { code: c.slug, members: c.members, plugins: c.plugins.length }));
        const names = c.plugins.map((p) => pluginNames.get(p.id) ?? p.id).join(" ");
        row(s, `${c.name} ${c.slug} ${c.emailDomains} ${names}`, () => this.go({ tab: "companies", companyId: c.id }));
      });
    }
  }

  private createCompany(): void {
    new FormModal(
      this.app,
      t("newCompany"),
      [
        { key: "name", name: t("companyName"), required: true, placeholder: "ACME" },
        { key: "slug", name: t("companyCode"), desc: t("companyCodeDesc"), required: true, placeholder: "acme" },
        { key: "emailDomains", name: t("emailDomains"), desc: t("emailDomainsDesc"), placeholder: "acme.ru, acme.com" },
      ],
      t("createCompany"),
      async (v) => {
        const company = await this.plugin.client.createCompany({ name: v.name, slug: v.slug.toLowerCase(), emailDomains: v.emailDomains ?? "" });
        new Notice(t("companyCreated", { name: company.name }));
        this.go({ tab: "companies", companyId: company.id });
      },
    ).open();
  }

  private async renderCompany(el: HTMLElement, companyId: number): Promise<void> {
    const { client } = this.plugin;
    const [detail, plugins] = await Promise.all([client.company(companyId), client.plugins()]);
    const { company, members } = detail;
    this.backLink(el, t("companies"), { tab: "companies" });
    el.createEl("h2", { text: company.name });

    // Code, name and domains are saved when the field loses focus.
    const general = new SettingGroup(el);
    general.addSetting((s) =>
      void s.setName(t("companyCode")).setDesc(t("companyCodeDesc")).addText((text) => {
        text.setValue(company.slug);
        text.inputEl.addEventListener("change", () => {
          const slug = text.getValue().trim().toLowerCase();
          if (slug && slug !== company.slug) void this.act(() => client.updateCompany(company.id, { slug }), t("companyCodeChanged", { code: slug }));
        });
      }),
    );
    general.addSetting((s) =>
      void s.setName(t("companyName")).addText((text) => {
        text.setValue(company.name);
        text.inputEl.addEventListener("change", () => {
          const name = text.getValue().trim();
          if (name && name !== company.name) void this.act(() => client.updateCompany(company.id, { name }), t("saved"));
        });
      }),
    );
    general.addSetting((s) =>
      void s.setName(t("emailDomains")).setDesc(t("emailDomainsDesc")).addText((text) => {
        text.setPlaceholder("acme.ru, acme.com").setValue(company.emailDomains);
        text.inputEl.addEventListener("change", () =>
          void this.act(() => client.updateCompany(company.id, { emailDomains: text.getValue() }), t("saved")),
        );
      }),
    );

    const access = new Map(detail.plugins.map((p) => [p.id, p]));
    const pluginGroup = new SettingGroup(el).setHeading(t("companyPlugins"));
    pluginGroup.addSetting((s) => void s.setDesc(t("companyPluginsDesc")));
    if (plugins.length === 0) pluginGroup.addSetting((s) => void s.setDesc(t("noPluginsYet")));
    for (const p of plugins) {
      pluginGroup.addSetting((s) => {
        s.setName(p.name).setDesc(p.id);
        this.accessDropdown(s, levelOf(access.get(p.id)), (level) => {
          if (level === "none") access.delete(p.id);
          else access.set(p.id, { id: p.id, required: level === "required" });
          void this.act(() => client.setCompanyPlugins(company.id, [...access.values()] as Access[]), t("saved"));
        });
      });
    }

    const memberGroup = new SettingGroup(el).setHeading(t("members", { n: members.length }));
    if (members.length === 0) memberGroup.addSetting((s) => void s.setDesc(t("noMembers")));
    for (const u of members) {
      memberGroup.addSetting((s) => {
        s.setName(u.email).setDesc([u.name, u.signedIn ? "" : t("userNeverSignedIn")].filter(Boolean).join(" · "));
        s.addButton((b) => {
          let armed = false;
          b.setButtonText(t("remove")).onClick(() => {
            if (!armed) {
              armed = true;
              b.setButtonText(t("removeConfirm")).setDestructive();
              window.setTimeout(() => {
                armed = false;
                b.setButtonText(t("remove")).buttonEl.removeClass("mod-warning", "mod-destructive");
              }, 4000);
              return;
            }
            void this.act(() => client.removeMember(company.id, u.id));
          });
        });
      });
    }
    memberGroup.addSetting((s) => {
      let email = "";
      const add = (): void => {
        if (!email.trim()) return;
        void this.act(() => client.addMember(company.id, email.trim()), t("memberAdded", { email: email.trim() }));
      };
      s.setName(t("addMember"))
        .setDesc(t("addMemberDesc"))
        .addText((text) => {
          text.setPlaceholder("user@example.com").onChange((v) => (email = v));
          text.inputEl.type = "email";
          text.inputEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") add();
          });
        })
        .addButton((b) => b.setIcon("user-plus").setTooltip(t("addMember")).onClick(add));
    });

    new SettingGroup(el).addSetting((s) =>
      void s
        .setName(t("deleteCompany"))
        .setDesc(t("deleteCompanyDesc"))
        .addButton((b) =>
          b
            .setButtonText(t("delete"))
            .setDestructive()
            .onClick(async () => {
              const ok = await confirmAction(this.app, t("deleteCompany"), t("deleteCompanyConfirm", { name: company.name }), t("delete"));
              if (!ok) return;
              this.route = { tab: "companies" };
              await this.act(() => client.deleteCompany(company.id), t("companyDeleted", { name: company.name }));
            }),
        ),
    );
  }

  // ---------- Users ----------

  private async renderUsers(el: HTMLElement): Promise<void> {
    const { client } = this.plugin;
    const [users, companies] = await Promise.all([client.users(), client.companies()]);
    const names = new Map(companies.map((c) => [c.id, c.name]));
    const { group, row } = this.listGroup(el, t("users"), null, null);
    if (users.length === 0) group.addSetting((s) => void s.setDesc(t("noUsers")));
    for (const u of users) {
      const companyNames = u.companyIds.map((id) => names.get(id) ?? `#${id}`);
      group.addSetting((s) => {
        const status = u.signedIn ? t("userSince", { date: formatDate(u.createdAt) }) : t("userNeverSignedIn");
        const sessions = u.sessions > 0 ? t("userSessions", { n: u.sessions }) : "";
        s.setName(u.email).setDesc([u.name, status, sessions].filter(Boolean).join(" · "));
        const chips = s.controlEl.createDiv({ cls: "silk-admin-chips" });
        if (companyNames.length === 0) chips.createSpan({ cls: "silk-admin-muted", text: t("noCompaniesShort") });
        for (const name of companyNames) chips.createSpan({ cls: "silk-admin-chip", text: name });
        s.addExtraButton((b) =>
          b
            .setIcon("pencil")
            .setTooltip(t("editCompanies"))
            .onClick(() =>
              new UserCompaniesModal(this.app, u.email, companies, u.companyIds, async (ids) => {
                await client.setUserCompanies(u.id, ids);
                new Notice(t("saved"));
                void this.render();
              }).open(),
            ),
        );
        if (u.sessions > 0) {
          s.addExtraButton((b) =>
            b
              .setIcon("log-out")
              .setTooltip(t("signOutUser"))
              .onClick(async () => {
                if (!(await confirmAction(this.app, t("signOutUser"), t("signOutUserConfirm", { email: u.email }), t("signOutUser")))) return;
                let ended = 0;
                await this.act(async () => (ended = await client.signOutUser(u.id)));
                new Notice(t("sessionsEnded", { n: ended }));
              }),
          );
        }
        s.addExtraButton((b) =>
          b
            .setIcon("trash-2")
            .setTooltip(t("deleteUser"))
            .onClick(async () => {
              if (!(await confirmAction(this.app, t("deleteUser"), t("deleteUserConfirm", { email: u.email }), t("delete")))) return;
              await this.act(() => client.deleteUser(u.id), t("userDeleted", { email: u.email }));
            }),
        );
        row(s, `${u.email} ${u.name} ${companyNames.join(" ")}`);
      });
    }
  }

  // ---------- Plugins ----------

  private async renderPlugins(el: HTMLElement): Promise<void> {
    const plugins = await this.plugin.client.plugins();
    const { group, row } = this.listGroup(el, t("plugins"), t("newPlugin"), () => this.createPlugin());
    if (plugins.length === 0) group.addSetting((s) => void s.setDesc(t("noPlugins")));
    for (const p of plugins) {
      group.addSetting((s) => {
        s.setName(p.name).setDesc(t("pluginSummary", { id: p.id, latest: latestText(p) }));
        if (!p.hasPublishToken) s.controlEl.createSpan({ cls: "silk-admin-chip mod-warning", text: t("noTokenShort") });
        row(s, `${p.name} ${p.id} ${p.repo}`, () => this.go({ tab: "plugins", pluginId: p.id }));
      });
    }
  }

  private createPlugin(): void {
    new FormModal(
      this.app,
      t("newPlugin"),
      [
        { key: "id", name: t("pluginId"), desc: t("pluginIdDesc"), required: true, placeholder: "my-plugin" },
        { key: "name", name: t("pluginName"), required: true },
        { key: "repo", name: t("repo"), desc: t("repoDesc"), placeholder: "aoph/my-plugin" },
        { key: "description", name: t("description") },
        { key: "instructions", name: t("instructions"), desc: t("instructionsDesc"), multiline: true },
      ],
      t("newPlugin"),
      async (v) => {
        const created = await this.plugin.client.createPlugin({
          id: v.id,
          name: v.name,
          repo: v.repo ?? "",
          description: v.description ?? "",
          instructions: v.instructions ?? "",
        });
        new Notice(t("pluginCreated", { name: created.name }));
        this.go({ tab: "plugins", pluginId: created.id });
      },
    ).open();
  }

  private async renderPlugin(el: HTMLElement, pluginId: string): Promise<void> {
    const { client } = this.plugin;
    const [detail, companies] = await Promise.all([client.plugin(pluginId), client.companies()]);
    const { plugin } = detail;
    this.backLink(el, t("plugins"), { tab: "plugins" });
    el.createEl("h2", { text: plugin.name });

    // Text fields are saved when they lose focus.
    const general = new SettingGroup(el);
    const field = (key: "name" | "repo" | "description" | "instructions", name: string, desc?: string): void => {
      general.addSetting((s) => {
        s.setName(name);
        if (desc) s.setDesc(desc);
        const save = (value: string): void => {
          if (value.trim() === plugin[key] || (key === "name" && !value.trim())) return;
          void this.act(() => client.updatePlugin(plugin.id, { [key]: value }), t("saved"));
        };
        if (key === "instructions") {
          s.addTextArea((text) => {
            text.setValue(plugin[key]);
            text.inputEl.rows = 3;
            text.inputEl.addEventListener("change", () => save(text.getValue()));
          });
        } else {
          s.addText((text) => {
            text.setValue(plugin[key]);
            text.inputEl.addEventListener("change", () => save(text.getValue()));
          });
        }
      });
    };
    general.addSetting((s) => void s.setName(t("pluginId")).addText((text) => text.setValue(plugin.id).setDisabled(true)));
    field("name", t("pluginName"));
    field("repo", t("repo"), t("repoDesc"));
    field("description", t("description"));
    field("instructions", t("instructions"), t("instructionsDesc"));

    new SettingGroup(el).setHeading(t("publishing")).addSetting((s) =>
      void s.setDesc(plugin.hasPublishToken ? t("tokenIssued") : t("noToken")).addButton((b) => {
        b.setButtonText(plugin.hasPublishToken ? t("reissueToken") : t("issueToken"));
        if (!plugin.hasPublishToken) b.setCta();
        b.onClick(async () => {
          if (plugin.hasPublishToken) {
            const ok = await confirmAction(this.app, t("reissueToken"), t("reissueConfirm"), t("reissueToken"));
            if (!ok) return;
          }
          try {
            const { token, hubUrl } = await client.issuePublishToken(plugin.id);
            new TokenModal(this.app, plugin.name, token, hubUrl).open();
            void this.render();
          } catch (err) {
            new Notice(t("failed", { error: (err as Error).message }));
          }
        });
      }),
    );

    const access = new Map(detail.companies.map((c) => [c.id, c]));
    const accessGroup = new SettingGroup(el).setHeading(t("companyAccess"));
    if (companies.length === 0) accessGroup.addSetting((s) => void s.setDesc(t("noCompaniesYet")));
    for (const c of companies) {
      accessGroup.addSetting((s) => {
        s.setName(c.name).setDesc(c.slug);
        this.accessDropdown(s, levelOf(access.get(c.id)), (level) => {
          if (level === "none") access.delete(c.id);
          else access.set(c.id, { id: c.id, required: level === "required" });
          void this.act(() => client.setPluginCompanies(plugin.id, [...access.values()]), t("saved"));
        });
      });
    }

    const cardGroup = new SettingGroup(el).setHeading(detail.card ? t("cardFrom", { version: detail.card.version }) : t("card"));
    if (detail.card) {
      cardGroup.addSetting((s) => {
        s.settingEl.addClass("silk-admin-doc-setting");
        const box = s.infoEl.createDiv({ cls: "markdown-rendered silk-admin-doc" });
        void MarkdownRenderer.render(this.app, detail.card!.markdown, box, "", this.docs);
      });
    } else {
      cardGroup.addSetting((s) => void s.setDesc(t("noCard")));
    }
    new SettingGroup(el).setHeading(t("guide")).addSetting((s) => {
      if (!detail.guide) return void s.setDesc(t("noGuide"));
      const guide = detail.guide;
      s.setDesc(t("guideFrom", { version: guide.version })).addButton((b) =>
        b.setButtonText(t("showGuide")).onClick(() => new MarkdownModal(this.app, `${plugin.name}: ${t("guide")}`, guide.markdown).open()),
      );
    });

    const releaseGroup = new SettingGroup(el).setHeading(t("releases"));
    releaseGroup.addExtraButton((b) =>
      b
        .setIcon("upload")
        .setTooltip(t("uploadRelease"))
        .onClick(() =>
          new UploadReleaseModal(this.app, plugin.name, async (notes, files) => {
            const { version } = await client.uploadRelease(plugin.id, notes, files);
            new Notice(t("releaseUploaded", { version }));
            void this.render();
          }).open(),
        ),
    );
    if (detail.releases.length === 0) releaseGroup.addSetting((s) => void s.setDesc(t("noReleasesYet")));
    for (const r of detail.releases) releaseGroup.addSetting((s) => this.renderRelease(s, plugin.id, r));

    new SettingGroup(el).addSetting((s) =>
      void s
        .setName(t("deletePlugin"))
        .setDesc(t("deletePluginDesc"))
        .addButton((b) =>
          b
            .setButtonText(t("delete"))
            .setDestructive()
            .onClick(async () => {
              const ok = await confirmAction(this.app, t("deletePlugin"), t("deletePluginConfirm", { name: plugin.name }), t("delete"));
              if (!ok) return;
              this.route = { tab: "plugins" };
              await this.act(() => client.deletePlugin(plugin.id), t("pluginDeleted", { name: plugin.name }));
            }),
        ),
    );
  }

  private renderRelease(s: Setting, pluginId: string, r: Release): void {
    const { client } = this.plugin;
    s.settingEl.addClass("silk-admin-release");
    const name = s.nameEl;
    name.setText(r.version);
    if (r.revoked) name.createSpan({ cls: "silk-admin-chip mod-warning", text: t("revoked") });
    s.descEl.setText(t("releaseMeta", { date: formatDate(r.publishedAt), min: r.minAppVersion }));
    if (r.files.length > 0) {
      s.descEl.createDiv({
        cls: "silk-admin-muted",
        text: `${t("releaseFiles")}: ${r.files.map((f) => `${f.name} (${formatSize(f.size)})`).join(", ")}`,
      });
    }
    if (r.changes.length > 0) {
      const list = s.infoEl.createEl("ul", { cls: "silk-admin-changes" });
      for (const c of r.changes) {
        const li = list.createEl("li");
        li.createSpan({ cls: "silk-admin-chip", text: t(TYPE_LABELS[c.type] ?? "typeOther") });
        li.appendText(" " + c.text);
        if (c.why) li.createSpan({ cls: "silk-admin-muted", text: ` — ${c.why}` });
      }
    }
    s.addButton((b) => {
      b.setButtonText(r.revoked ? t("restore") : t("revoke"));
      if (!r.revoked) b.setDestructive();
      b.onClick(async () => {
        if (!r.revoked) {
          const ok = await confirmAction(this.app, t("revoke"), t("revokeConfirm", { version: r.version }), t("revoke"));
          if (!ok) return;
        }
        await this.act(
          () => client.setReleaseRevoked(pluginId, r.version, !r.revoked),
          t(r.revoked ? "releaseRestored" : "releaseRevoked", { version: r.version }),
        );
      });
    });
    s.addExtraButton((b) =>
      b
        .setIcon("trash-2")
        .setTooltip(t("deleteRelease"))
        .onClick(async () => {
          if (!(await confirmAction(this.app, t("deleteRelease"), t("deleteReleaseConfirm", { version: r.version }), t("delete")))) return;
          await this.act(() => client.deleteRelease(pluginId, r.version), t("releaseDeleted", { version: r.version }));
        }),
    );
  }

  // ---------- Administrators ----------

  private async renderAdmins(el: HTMLElement): Promise<void> {
    const { client } = this.plugin;
    const admins = await client.admins();
    const { group, row } = this.listGroup(el, t("admins"), t("newAdmin"), () => this.createAdmin());
    for (const a of admins) {
      group.addSetting((s) => {
        s.setName(a.username);
        if (a.self) {
          s.setDesc(t("adminYou")).addButton((b) => b.setButtonText(t("changePassword")).onClick(() => this.plugin.openChangePassword()));
        } else {
          s.addExtraButton((b) =>
            b
              .setIcon("trash-2")
              .setTooltip(t("deleteAdmin"))
              .onClick(async () => {
                if (!(await confirmAction(this.app, t("deleteAdmin"), t("deleteAdminConfirm", { name: a.username }), t("delete")))) return;
                await this.act(() => client.deleteAdmin(a.username), t("adminDeleted", { name: a.username }));
              }),
          );
        }
        row(s, a.username);
      });
    }
  }

  private createAdmin(): void {
    new FormModal(
      this.app,
      t("newAdmin"),
      [
        { key: "username", name: t("adminLogin"), desc: t("adminLoginDesc"), required: true },
        { key: "password", name: t("adminPassword"), desc: t("adminPasswordDesc"), required: true, password: true },
      ],
      t("newAdmin"),
      async (v) => {
        await this.plugin.client.createAdmin(v.username, v.password);
        new Notice(t("adminCreated", { name: v.username }));
        void this.render();
      },
    ).open();
  }
}

function latestText(p: PluginRow): string {
  return p.latest ? t("latestVersion", { version: p.latest.version }) : t("noReleases");
}
