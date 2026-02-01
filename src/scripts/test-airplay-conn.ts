#!/usr/bin/env bun
/**
 * AirPlay Pairing Script
 *
 * Usage: bun run airplay-pair.ts <host> [port]
 *
 * Examples:
 *   bun run airplay-pair.ts 192.168.1.100
 *   bun run airplay-pair.ts 192.168.1.100 7000
 */

import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";

// Import your existing layers
import { BunTCPTransport } from "@/protocols/shared/layers/BunTCPTransport.ts";
import { ChaCha20EncryptionLayer } from "@/protocols/shared/layers/ChaCha20EncryptionLayer.ts";
import { HttpFramedChannel } from "@/protocols/airplay/layers/HttpFramedChannel";
import {
  AirPlayAuthClient,
  type AirPlayCredentials,
} from "@/protocols/airplay/layers/AirPlayAuthenticationService.ts";
import type { DerivedKeys } from "@/core/crypto/hkdf.ts";
import { RtspSession } from "@/protocols/rtsp/RtspSession.ts";
import { Airplay2Session } from "@/protocols/airplay/layers/AIrplay2Session.ts";
import { AppleTVDiscoveryService } from "@/core/discovery/apple-device-discovery.ts";
import { JsonStorage } from "@/core/storage/json-storage.ts";
import {
  deviceInfoMessage,
  DeviceInfoMessage,
} from "@/protocols/mrp/generated/DeviceInfoMessage.ts";
import {
  ErrorCode_Enum,
  ProtocolMessage,
  ProtocolMessage_Type,
} from "@/protocols/mrp/generated/ProtocolMessage.ts";
import { sleep } from "bun";
import { DeviceClass_Enum } from "@/protocols/mrp/generated/Common.ts";
import {
  notificationMessage,
  NotificationMessage,
} from "@/protocols/mrp/generated/NotificationMessage.ts";
import { MRPProtocol } from "@/protocols/mrp/MRPProtocol.ts";

// Credentials storage path
const CREDENTIALS_DIR = path.join(process.env.HOME || "~", ".bunatv");
const CREDENTIALS_FILE = path.join(CREDENTIALS_DIR, "airplay-credentials.json");

interface StoredCredentials {
  [deviceId: string]: {
    credentials: AirPlayCredentials;
    deviceName?: string;
    lastConnected: string;
  };
}

/**
 * Prompt user for PIN via terminal
 */
async function promptForPin(deviceName?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const prompt = deviceName
      ? `Enter the PIN shown on "${deviceName}": `
      : "Enter the 4-digit PIN shown on your Apple TV: ";

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * CLI Entry Point
 */
async function main() {
  const args = process.argv.slice(2);
  //
  //   if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
  //     console.log(`
  // Usage: bun run airplay-pair.ts <host> [port]
  //
  // Arguments:
  //   host    IP address or hostname of the Apple TV
  //   port    AirPlay port (default: 7000)
  //
  // Options:
  //   --help, -h     Show this help message
  //   --list, -l     List stored credentials
  //   --forget       Forget credentials for a device
  //
  // Examples:
  //   bun run airplay-pair.ts 192.168.1.100
  //   bun run airplay-pair.ts 192.168.1.100 7000
  //   bun run airplay-pair.ts --list
  //   bun run airplay-pair.ts --forget 192.168.1.100:7000
  // `)
  //     process.exit(0)
  //   }
  //
  //   if (args.includes('--list') || args.includes('-l')) {
  //     const stored = loadCredentials()
  //     const devices = Object.keys(stored)
  //
  //     if (devices.length === 0) {
  //       console.log('No stored credentials found.')
  //     } else {
  //       console.log('\nStored AirPlay Credentials:')
  //       console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  //       for (const deviceId of devices) {
  //         const entry = stored[deviceId]
  //         console.log(`  ${deviceId}`)
  //         if (entry?.deviceName) {
  //           console.log(`    Name: ${entry.deviceName}`)
  //         }
  //         console.log(`    Last connected: ${entry?.lastConnected}`)
  //         console.log()
  //       }
  //     }
  //     process.exit(0)
  //   }
  //
  //   if (args.includes('--forget')) {
  //     const forgetIndex = args.indexOf('--forget')
  //     const deviceId = args[forgetIndex + 1]
  //
  //     if (!deviceId) {
  //       console.error('Please specify device ID to forget')
  //       process.exit(1)
  //     }
  //
  //     const stored = loadCredentials()
  //     if (stored[deviceId]) {
  //       delete stored[deviceId]
  //       fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(stored, null, 2))
  //       console.log(`Forgot credentials for ${deviceId}`)
  //     } else {
  //       console.log(`No credentials found for ${deviceId}`)
  //     }
  //     process.exit(0)
  //   }

  // Parse host and port
  const host = "192.168.1.40";
  const port = parseInt("7000", 10);

  if (!host) {
    console.error("Please provide a host address");
    process.exit(1);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error("Invalid port number");
    process.exit(1);
  }

  try {
    const discovery = new AppleTVDiscoveryService();
    const allDevices = await discovery.getAllAppleDevices();

    const device = await discovery.getAppleDeviceByIPAddress(host);

    const storage = new JsonStorage();

    if (!device) {
      throw new Error(`Device not found at ${host}`);
    }
    const clientDeviceInfo = await storage.getClientDeviceInfo();

    // 1. Create session (requires discovered device + storage for credentials)
    const session = await Airplay2Session.create(device, storage);

    // 2. Listen for events
    session.on("ready", () => {
      console.log("Session ready!");
    });

    session.on("data-received", (data: Buffer) => {
      // Handle incoming data from the data channel (protobuf messages)
    });

    session.on("event-received", (data: Buffer) => {
      // Handle incoming events from the event channel
    });

    session.on("error", (error, context) => {
      console.error(`Error in ${context}:`, error);
    });

    // 3. Connect (with optional PIN callback for first-time pairing)
    await session.connect({
      onPinRequired: async () => {
        // Show PIN prompt to user, return the 4-digit PIN
        return promptForPin("My Apple TV");
      },
    });

    const protocol = new MRPProtocol(session, clientDeviceInfo);

    await protocol.start();
  } catch (error) {
    console.error("\nFatal error:", error);
    process.exit(1);
  }
}

main();
