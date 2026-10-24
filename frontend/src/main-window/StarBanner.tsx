import { useApp } from "../state/context";
import { Action, Banner } from "./Banner";

export function StarBanner() {
  const shown = useApp((state) => state.starShown);
  const starOnGitHub = useApp((state) => state.starOnGitHub);
  const starNotNow = useApp((state) => state.starNotNow);
  if (!shown) return null;
  return (
    <Banner
      kind="info"
      icon="nodes-star"
      actions={
        <>
          <Action onClick={starOnGitHub}>Star on GitHub</Action>
          <span className="app-banner-sep" aria-hidden="true">
            |
          </span>
          <Action onClick={starNotNow}>Not now</Action>
        </>
      }
    >
      Give us a star on GitHub.
    </Banner>
  );
}
