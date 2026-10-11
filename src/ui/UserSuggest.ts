import { AbstractInputSuggest, App } from "obsidian";
import type { User } from "../api/AdminClient";

/** Suggests Hub users by email or name as you type; the list is filtered by `available` on every keystroke. */
export class UserSuggest extends AbstractInputSuggest<User> {
  constructor(
    app: App,
    private inputEl: HTMLInputElement,
    private available: () => User[],
  ) {
    super(app, inputEl);
    this.limit = 20;
  }

  protected getSuggestions(query: string): User[] {
    const q = query.toLowerCase().trim();
    return this.available().filter((u) => q === "" || u.email.includes(q) || u.name.toLowerCase().includes(q));
  }

  renderSuggestion(user: User, el: HTMLElement): void {
    el.createDiv({ text: user.email });
    if (user.name) el.createEl("small", { cls: "silk-admin-muted", text: user.name });
  }

  selectSuggestion(user: User, evt: MouseEvent | KeyboardEvent): void {
    super.selectSuggestion(user, evt);
    this.inputEl.value = "";
    this.close();
  }
}
