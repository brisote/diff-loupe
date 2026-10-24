export interface ManifestScene {
  name: string;
  description: string;
  width: number;
  height: number;
}

export function findScene(scenes: ManifestScene[], name: string): ManifestScene {
  const found = scenes.find((scene) => scene.name === name);
  if (!found) throw new Error(`The screenshot manifest has no scene named "${name}".`);
  return found;
}

export function sceneFiles(scenes: ManifestScene[]): string[] {
  return scenes.flatMap((scene) => [`${scene.name}-light.png`, `${scene.name}-dark.png`]);
}
