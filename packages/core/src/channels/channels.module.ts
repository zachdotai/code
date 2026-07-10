import { ContainerModule } from "inversify";
import { ChannelsService } from "./channels";
import { DESKTOP_FS_CLIENT, DesktopFsClient } from "./desktopFsClient";
import { CHANNELS_SERVICE } from "./identifiers";

// Host-agnostic channels feature. Owns the shared DesktopFsClient (the project's
// desktop_file_system surface) that both channel task-filing and canvas
// dashboards compose, so any host that loads this module gets the FS client too.
// ChannelLinkService is host-bound (deep-link registry + main window) and is
// bound directly by the desktop app container, like the other link services.
export const channelsCoreModule = new ContainerModule(({ bind }) => {
  bind(DesktopFsClient).toSelf().inSingletonScope();
  bind(DESKTOP_FS_CLIENT).toService(DesktopFsClient);

  bind(ChannelsService).toSelf().inSingletonScope();
  bind(CHANNELS_SERVICE).toService(ChannelsService);
});
