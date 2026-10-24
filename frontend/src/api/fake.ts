import type { CoreEvent } from "./generated/CoreEvent";
import type { Listener, Transport } from "./transport";

export type Handler = (args: unknown) => unknown;

export class FakeTransport implements Transport {
  readonly kind = "bridge" as const;
  readonly calls: { cmd: string; args: unknown }[] = [];
  picked: string | null = null;
  removable: string[] = [];
  uninstalled = false;
  uninstallError: unknown = null;
  installed = false;
  installs = 0;
  installError: unknown = null;
  uninstallInfoError: unknown = null;
  readonly opened: string[] = [];
  private readonly events = new Set<Listener<CoreEvent>>();
  private readonly drops = new Set<Listener<string>>();

  constructor(private readonly handlers: Record<string, Handler>) {}

  async send(cmd: string, args: unknown): Promise<unknown> {
    this.calls.push({ cmd, args });
    const handler = this.handlers[cmd];
    if (!handler) throw { code: "unknownCommand", message: `unknown command ${cmd}` };
    return handler(args);
  }

  async pickFolder() {
    return this.picked;
  }

  async uninstallInfo() {
    if (this.uninstallInfoError) throw this.uninstallInfoError;
    return this.removable;
  }

  async openLink(url: string) {
    this.opened.push(url);
  }

  async installUpdate() {
    this.installs++;
    if (this.installError) throw this.installError;
    this.installed = true;
  }

  async uninstall() {
    if (this.uninstallError) throw this.uninstallError;
    this.uninstalled = true;
  }

  onEvent(listener: Listener<CoreEvent>) {
    this.events.add(listener);
    return () => this.events.delete(listener);
  }

  onFolderDrop(listener: Listener<string>) {
    this.drops.add(listener);
    return () => this.drops.delete(listener);
  }

  emit(event: CoreEvent) {
    for (const listener of this.events) listener(event);
  }

  drop(path: string) {
    for (const listener of this.drops) listener(path);
  }
}
