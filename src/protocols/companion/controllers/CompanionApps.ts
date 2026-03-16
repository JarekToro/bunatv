/**
 * CompanionApps - App launching for Apple TV via Companion protocol
 */

import type { CompanionProtocol } from "@/protocols/companion/CompanionProtocol.ts";
import {
  createLaunchAppCommand,
  createFetchLaunchableApplicationsCommand,
} from "@/protocols/companion/messages/launchApp.ts";
import { createLogger } from "@/logging/logging.ts";

const logger = createLogger("bunatv:companion:apps");

export class CompanionApps {
  constructor(private readonly protocol: CompanionProtocol) {}

  async launch(bundleId: string): Promise<void> {
    logger.debug({ bundleId }, "Launching app");
    await this.protocol.sendCommand(createLaunchAppCommand(bundleId));
  }

  async launchUrl(url: string): Promise<void> {
    logger.debug({ url }, "Launching URL");
    await this.protocol.sendCommand(createLaunchAppCommand(undefined, url));
  }

  async fetchLaunchable(): Promise<{ bundleId: string; name: string }[]> {
    logger.debug("Fetching launchable applications");
    const result = await this.protocol.sendCommand(
      createFetchLaunchableApplicationsCommand()
    );
    logger.debug({ count: result.count }, "Launchable applications fetched");
    return result.apps;
  }
}
