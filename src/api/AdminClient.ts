import { App, requestUrl, RequestUrlResponse } from "obsidian";

const TOKEN_SECRET = "silk-plugins-hub-admin-token";

export class AdminError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message);
  }
}

export interface Access {
  id: number | string;
  required: boolean;
}

export interface Company {
  id: number;
  name: string;
  slug: string;
  emailDomains: string;
}

export interface CompanyRow extends Company {
  members: number;
  plugins: { id: string; required: boolean }[];
}

export interface User {
  id: number;
  email: string;
  name: string;
  signedIn: boolean;
  createdAt: string | null;
}

export interface UserRow extends User {
  companyIds: number[];
  /** Active sessions: vaults where the user is signed in. */
  sessions: number;
}

export interface Admin {
  username: string;
  self: boolean;
}

/** A file for a release uploaded by hand: name and base64 contents. */
export interface UploadFile {
  name: string;
  data: string;
}

export interface Plugin {
  id: string;
  name: string;
  repo: string;
  description: string;
  instructions: string;
  hasPublishToken: boolean;
}

export interface PluginRow extends Plugin {
  latest: { version: string; publishedAt: string } | null;
}

export interface Change {
  type: string;
  text: string;
  why: string;
}

export interface Release {
  version: string;
  publishedAt: string;
  minAppVersion: string;
  revoked: boolean;
  changes: Change[];
  files: { name: string; size: number }[];
}

export interface Doc {
  version: string;
  markdown: string;
}

export interface PluginDetail {
  plugin: Plugin;
  companies: { id: number; required: boolean }[];
  releases: Release[];
  card: Doc | null;
  guide: Doc | null;
}

export interface CompanyDetail {
  company: Company;
  members: User[];
  plugins: { id: string; required: boolean }[];
}

export type PluginFields = Partial<Pick<Plugin, "name" | "repo" | "description" | "instructions">>;

/**
 * Talks to the admin API of a Silk Hub server. The admin token lives in Obsidian's
 * SecretStorage; when the server rejects it, the client forgets it and reports the sign-out.
 */
export class AdminClient {
  constructor(
    private app: App,
    private getServerUrl: () => string,
    private onSignedOut: () => void,
  ) {}

  get serverUrl(): string {
    return this.getServerUrl().trim().replace(/\/+$/, "");
  }

  get signedIn(): boolean {
    return !!this.app.secretStorage.getSecret(TOKEN_SECRET);
  }

  async signIn(username: string, password: string): Promise<string> {
    const res = await this.raw("POST", "/admin-api/login", { username, password });
    if (res.status !== 200) throw errorOf(res);
    const { token, username: name } = res.json as { token: string; username: string };
    this.app.secretStorage.setSecret(TOKEN_SECRET, token);
    return name;
  }

  async signOut(): Promise<void> {
    if (this.signedIn && this.serverUrl) await this.call("POST", "/admin-api/logout").catch(() => undefined);
    this.app.secretStorage.setSecret(TOKEN_SECRET, "");
  }

  me(): Promise<{ username: string; hubUrl: string }> {
    return this.call("GET", "/admin-api/me");
  }

  // ---------- Companies ----------
  async companies(): Promise<CompanyRow[]> {
    return (await this.call<{ companies: CompanyRow[] }>("GET", "/admin-api/companies")).companies;
  }

  createCompany(body: { name: string; slug: string; emailDomains: string }): Promise<Company> {
    return this.call("POST", "/admin-api/companies", body);
  }

  company(id: number): Promise<CompanyDetail> {
    return this.call("GET", `/admin-api/companies/${id}`);
  }

  updateCompany(id: number, body: { name?: string; slug?: string; emailDomains?: string }): Promise<Company> {
    return this.call("PATCH", `/admin-api/companies/${id}`, body);
  }

  deleteCompany(id: number): Promise<void> {
    return this.call("DELETE", `/admin-api/companies/${id}`);
  }

  setCompanyPlugins(id: number, plugins: Access[]): Promise<void> {
    return this.call("PUT", `/admin-api/companies/${id}/plugins`, { plugins });
  }

  addMember(companyId: number, email: string): Promise<User> {
    return this.call("POST", `/admin-api/companies/${companyId}/members`, { email });
  }

  /** Adds several people by email at once: a list or text separated by commas, spaces or new lines. */
  addMembers(companyId: number, emails: string): Promise<{ added: User[]; invalid: string[] }> {
    return this.call("POST", `/admin-api/companies/${companyId}/members`, { emails });
  }

  removeMember(companyId: number, userId: number): Promise<void> {
    return this.call("DELETE", `/admin-api/companies/${companyId}/members/${userId}`);
  }

  // ---------- Users ----------
  async users(): Promise<UserRow[]> {
    return (await this.call<{ users: UserRow[] }>("GET", "/admin-api/users")).users;
  }

  setUserCompanies(userId: number, companyIds: number[]): Promise<void> {
    return this.call("PUT", `/admin-api/users/${userId}/companies`, { companyIds });
  }

  /** Ends the user's sessions in every vault; returns how many ended. */
  async signOutUser(userId: number): Promise<number> {
    return (await this.call<{ ended: number }>("POST", `/admin-api/users/${userId}/sign-out`)).ended;
  }

  deleteUser(userId: number): Promise<void> {
    return this.call("DELETE", `/admin-api/users/${userId}`);
  }

  // ---------- Administrators ----------
  async admins(): Promise<Admin[]> {
    return (await this.call<{ admins: Admin[] }>("GET", "/admin-api/admins")).admins;
  }

  createAdmin(username: string, password: string): Promise<void> {
    return this.call("POST", "/admin-api/admins", { username, password });
  }

  deleteAdmin(username: string): Promise<void> {
    return this.call("DELETE", `/admin-api/admins/${encodeURIComponent(username)}`);
  }

  /** Changes this admin's password; other sessions end and this one continues with a fresh token. */
  async changePassword(current: string, password: string): Promise<void> {
    const { token } = await this.call<{ token: string }>("POST", "/admin-api/me/password", { current, password });
    this.app.secretStorage.setSecret(TOKEN_SECRET, token);
  }

  // ---------- Plugins ----------
  async plugins(): Promise<PluginRow[]> {
    return (await this.call<{ plugins: PluginRow[] }>("GET", "/admin-api/plugins")).plugins;
  }

  createPlugin(body: PluginFields & { id: string }): Promise<Plugin> {
    return this.call("POST", "/admin-api/plugins", body);
  }

  plugin(id: string): Promise<PluginDetail> {
    return this.call("GET", `/admin-api/plugins/${encodeURIComponent(id)}`);
  }

  updatePlugin(id: string, body: PluginFields): Promise<Plugin> {
    return this.call("PATCH", `/admin-api/plugins/${encodeURIComponent(id)}`, body);
  }

  deletePlugin(id: string): Promise<void> {
    return this.call("DELETE", `/admin-api/plugins/${encodeURIComponent(id)}`);
  }

  issuePublishToken(id: string): Promise<{ token: string; hubUrl: string }> {
    return this.call("POST", `/admin-api/plugins/${encodeURIComponent(id)}/token`);
  }

  setPluginCompanies(id: string, companies: Access[]): Promise<void> {
    return this.call("PUT", `/admin-api/plugins/${encodeURIComponent(id)}/companies`, { companies });
  }

  /** Publishes a release from files picked by the admin, without CI. */
  uploadRelease(id: string, notes: string, files: UploadFile[]): Promise<{ version: string; files: string[] }> {
    return this.call("POST", `/admin-api/plugins/${encodeURIComponent(id)}/releases`, { notes, files });
  }

  deleteRelease(id: string, version: string): Promise<void> {
    return this.call("DELETE", `/admin-api/plugins/${encodeURIComponent(id)}/releases/${encodeURIComponent(version)}`);
  }

  setReleaseRevoked(id: string, version: string, revoked: boolean): Promise<void> {
    const action = revoked ? "revoke" : "restore";
    return this.call("POST", `/admin-api/plugins/${encodeURIComponent(id)}/releases/${encodeURIComponent(version)}/${action}`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = this.app.secretStorage.getSecret(TOKEN_SECRET);
    if (!token) throw new AdminError("not signed in", 401);
    const res = await this.raw(method, path, body, token);
    if (res.status === 401) {
      this.app.secretStorage.setSecret(TOKEN_SECRET, "");
      this.onSignedOut();
    }
    if (res.status < 200 || res.status >= 300) throw errorOf(res);
    return res.json as T;
  }

  private raw(method: string, path: string, body?: unknown, token?: string): Promise<RequestUrlResponse> {
    if (!this.serverUrl) throw new AdminError("server address is not set");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return requestUrl({
      url: this.serverUrl + path,
      method,
      headers,
      contentType: body === undefined ? undefined : "application/json",
      body: body === undefined ? undefined : JSON.stringify(body),
      throw: false,
    });
  }
}

function errorOf(res: RequestUrlResponse): AdminError {
  let message = `HTTP ${res.status}`;
  try {
    message = (res.json as { error?: string }).error ?? message;
  } catch {
    // Not JSON: keep the status.
  }
  return new AdminError(message, res.status);
}
