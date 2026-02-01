import mdns from "multicast-dns";
import type { Answer } from "dns-packet";

export interface MDNSResponse {
  answers: Answer[];
  additionals: Answer[];
}

/**
 * Active mDNS network discovery using multicast-dns
 * Sends queries and listens for responses on the network
 */
export class MDNSNetworkDiscovery {
  private mdns: any;
  private onResponse: (response: MDNSResponse) => void;
  private isRunning = false;

  constructor(onResponse: (response: MDNSResponse) => void) {
    this.onResponse = onResponse;
  }

  /**
   * Start listening for mDNS responses
   */
  start(): void {
    if (this.isRunning) return;

    this.mdns = mdns();
    this.isRunning = true;

    // Listen for responses
    this.mdns.on("response", (packet: any) => {
      this.onResponse({
        answers: packet.answers || [],
        additionals: packet.additionals || [],
      });
    });

    this.mdns.on("error", (err: Error) => {
      console.error("mDNS error:", err);
    });
  }

  /**
   * Stop listening and cleanup
   */
  stop(): void {
    if (!this.isRunning) return;

    this.mdns?.destroy();
    this.mdns = null;
    this.isRunning = false;
  }

  /**
   * Send mDNS queries for specific service types
   * Supports both multicast (default) and unicast (if port and address provided)
   */
  query(serviceTypes: string[], port?: number, address?: string): void {
    if (!this.isRunning) {
      throw new Error("MDNSNetworkDiscovery not started");
    }

    for (const serviceType of serviceTypes) {
      const packet = {
        questions: [
          {
            name: serviceType,
            type: "PTR",
          },
        ],
      };

      if (port && address) {
        this.mdns.query(packet, { port, address });
      } else {
        this.mdns.query(packet);
      }
    }
  }

  /**
   * Check if discovery is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
