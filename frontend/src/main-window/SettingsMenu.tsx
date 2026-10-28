import type { RefObject } from "react";
import { MenuRow } from "../lib/list";
import { shortcut, usePlatform } from "../lib/platform";
import { Popup } from "../lib/popup";
import { useApp } from "../state/context";
import type { Dialog } from "../state/store";

type Props = { anchor: RefObject<HTMLElement | null>; onClose: () => void };

export function SettingsMenu({ anchor, onClose }: Props) {
  const platform = usePlatform();
  const showDialog = useApp((state) => state.showDialog);
  const openUpdates = useApp((state) => state.openUpdates);
  const starOnGitHub = useApp((state) => state.starOnGitHub);
  const choose = (dialog: Dialog) => {
    onClose();
    showDialog(dialog);
  };
  return (
    <Popup
      label="Settings menu"
      role="menu"
      className="app-settings-menu"
      anchor={anchor}
      onClose={onClose}
    >
      <MenuRow onActivate={() => choose("settings")}>
        <span className="dl-row-name">Settings…</span>
        <span className="dl-row-path" />
        <span className="dl-row-key">{shortcut(platform, "Mod+,")}</span>
      </MenuRow>
      <div className="dl-popup-sep" />
      <MenuRow
        onActivate={() => {
          onClose();
          openUpdates();
        }}
      >
        <span className="dl-row-name">Check for updates…</span>
      </MenuRow>
      <MenuRow
        onActivate={() => {
          onClose();
          starOnGitHub();
        }}
      >
        <span className="dl-row-name">Star on GitHub</span>
      </MenuRow>
      <div className="dl-popup-sep" />
      <MenuRow onActivate={() => choose("about")}>
        <span className="dl-row-name">About Diffloupe</span>
      </MenuRow>
      <div className="dl-popup-sep" />
      <MenuRow onActivate={() => choose("uninstall")}>
        <span className="dl-row-name">Uninstall Diffloupe…</span>
      </MenuRow>
    </Popup>
  );
}
