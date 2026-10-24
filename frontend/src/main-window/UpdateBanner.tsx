import { useApp } from "../state/context";
import { Action, Banner } from "./Banner";

export function UpdateBanner() {
  const offer = useApp((state) => (state.noticeShown ? null : state.updateOffer));
  const install = useApp((state) => state.updateInstall);
  const laterUpdate = useApp((state) => state.laterUpdate);
  const downloadUpdate = useApp((state) => state.downloadUpdate);
  const restartToUpdate = useApp((state) => state.restartToUpdate);
  const laterInstall = useApp((state) => state.laterInstall);
  const openLink = useApp((state) => state.openLink);
  if (install.state === "ready" || install.state === "installing")
    return (
      <Banner
        kind="info"
        actions={
          install.state === "ready" && (
            <>
              <Action onClick={() => void restartToUpdate()}>Restart now</Action>
              <Action onClick={laterInstall}>Later</Action>
            </>
          )
        }
      >
        <b>Diffloupe {install.check.latest}</b> is ready. It installs when you restart Diffloupe.
      </Banner>
    );
  if (install.state === "failed")
    return (
      <Banner
        kind="error"
        actions={
          <>
            <Action onClick={() => void downloadUpdate(install.check)}>Try again</Action>
            <Action onClick={() => openLink(install.check.page)}>Release notes</Action>
            <Action onClick={laterInstall}>Later</Action>
          </>
        }
      >
        {install.message}
      </Banner>
    );
  if (install.state === "downloading" || !offer) return null;
  return (
    <Banner
      kind="info"
      actions={
        <>
          <Action onClick={() => void downloadUpdate(offer)}>Update</Action>
          <Action onClick={() => openLink(offer.page)}>Release notes</Action>
          <Action onClick={() => void laterUpdate()}>Later</Action>
        </>
      }
    >
      <b>Diffloupe {offer.latest}</b> is available.
    </Banner>
  );
}
