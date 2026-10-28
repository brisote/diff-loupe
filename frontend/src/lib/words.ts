import type { Platform } from "./platform";

export function aboutRemoval(platform: Platform): string {
  switch (platform) {
    case "macos":
      return "Dragging the app to the Trash leaves its settings on this Mac.";
    case "windows":
      return "Removing the app in Windows' Installed apps list leaves its settings on this computer.";
    case "linux":
      return "Removing the package with your package manager leaves its settings on this computer.";
  }
}

export function uninstallEffect(platform: Platform): string {
  switch (platform) {
    case "macos":
      return "This deletes Diffloupe's own files from this Mac, moves the app to the Trash and quits.";
    case "windows":
      return "This deletes Diffloupe's own files from this computer, removes the app and quits.";
    case "linux":
      return "This deletes Diffloupe's own files from this computer, removes the package after you enter your password, and quits.";
  }
}
