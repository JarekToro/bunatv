//@ts-nocheck

/**
 * Wizard command - Interactive setup wizard for Apple TV
 */

import { Command } from '@cliffy/command'
import { Select, Confirm, Input } from '@cliffy/prompt'
import { Table } from '@cliffy/table'
import type { DiscoveredDevice } from '../../core/discovery/discovery-types'
import { createOutput } from '../utils/output'
import type { GlobalOptions } from '@/cli/cli.ts'
import { DeviceManager } from '@/cli/core/device-manager.ts'
import { ProtocolManager } from '@/cli/core/protocol-manager.ts'
import { CredentialManager } from '@/cli/core/credential-manager.ts'
import { JsonStorage } from '@/core/storage/json-storage.ts'
import { AttentionState } from '@/protocols/companion/messages/systemPower.ts'
import { withErrorHandling } from '@/cli/utils/errors.ts'

export const wizardCommand = new Command<GlobalOptions>()
  .description('Interactive setup wizard for Apple TV connection')
  .action(async options => {
    const output = createOutput({
      format: options.output,
      verbose: options.verbose,
      quiet: options.quiet,
      noColor: options.color,
    })

    if (options.output === 'json') {
      output.error('Wizard mode does not support JSON output')
      process.exit(1)
    }

    if (options.quiet) {
      output.error('Wizard mode cannot run in quiet mode')
      process.exit(1)
    }

    output.info('🧙 Welcome to the BunATV Setup Wizard!')
    output.info('This wizard will help you discover and pair with your Apple TV.\n')

    // Step 1: Discovery
    output.section('Step 1: Device Discovery')

    const shouldDiscover = await Confirm.prompt({
      message: 'Would you like to scan for Apple TV devices?',
      default: true,
    })

    let selectedDevice: string

    if (shouldDiscover) {
      output.startSpinner('Scanning for devices...')

      // Real device discovery
      const deviceManager = new DeviceManager()
      let devices = await deviceManager.discover(5)

      // Filter to Companion-capable devices
      devices = deviceManager.filterByProtocol(devices, 'companion')

      if (devices.length === 0) {
        output.failSpinner('No devices found')
        output.error('Please check your network connection.')
        const manualEntry = await Confirm.prompt({
          message: 'Would you like to enter device details manually?',
          default: false,
        })

        if (!manualEntry) {
          output.info('Wizard cancelled.')
          process.exit(0)
        }

        selectedDevice = await Input.prompt({
          message: 'Enter device IP address or identifier:',
        })
      } else {
        output.succeedSpinner(`Found ${devices.length} device(s)`)

        // Check pairing status for each device
        const storage = new JsonStorage()
        const credManager = new CredentialManager(storage)

        const devicesWithStatus = await Promise.all(
          devices.map(async device => ({
            ...device,
            paired: await credManager.hasCredentials(device.identifier),
          }))
        )

        // Display found devices using Table directly to stderr
        const table = new Table()
          .header(['#', 'Name', 'Address', 'Model', 'Paired'])
          .body(
            devicesWithStatus.map((d, i) => [
              (i + 1).toString(),
              d.name,
              `${d.address}:${d.port}`,
              d.model || 'Unknown',
              d.paired ? '✓' : '✗',
            ])
          )
        console.error(table.toString())

        // Select device
        const deviceChoice = await Select.prompt({
          message: 'Select a device to pair with:',
          options: [
            ...devicesWithStatus.map(d => ({
              name: `${d.name} (${d.address})${d.paired ? ' [Already Paired]' : ''}`,
              value: d.identifier,
            })),
            { name: 'Enter manually', value: 'manual' },
          ],
        })

        if (deviceChoice === 'manual') {
          selectedDevice = await Input.prompt({
            message: 'Enter device IP address or identifier:',
          })
        } else {
          selectedDevice = deviceChoice
        }
      }
    } else {
      selectedDevice = await Input.prompt({
        message: 'Enter device IP address or identifier:',
      })
    }

    // Step 2: Protocol Selection
    output.section('Step 2: Protocol Selection')

    const protocol = await Select.prompt({
      message: 'Select pairing protocol:',
      options: [
        {
          name: 'Companion (Recommended) - Modern protocol with full features',
          value: 'companion',
        },
        {
          name: 'AirPlay - Legacy protocol for older devices',
          value: 'airplay',
        },
      ],
      default: 'companion',
    })

    // Step 3: Pairing
    output.section('Step 3: Device Pairing')

    // Find the device
    const storage = new JsonStorage()
    const deviceManager = new DeviceManager()
    const credManager = new CredentialManager(storage)

    await withErrorHandling(output, async () => {
      const device = await deviceManager.findDevice(selectedDevice)

      output.status('📱', `Preparing to pair with: ${device.name}`)
      output.info(`   Address: ${device.address}:${device.port}`)
      output.info(`   Protocol: ${protocol}`)

      // Check if already paired
      const alreadyPaired = await credManager.hasCredentials(device.identifier)

      if (alreadyPaired) {
        const shouldRepair = await Confirm.prompt({
          message: 'This device is already paired. Re-pair?',
          default: false,
        })

        if (!shouldRepair) {
          output.info('Skipping pairing (already paired).')
          // Skip to connection test
          return
        } else {
          output.info('Removing existing credentials...')
          await credManager.deleteCredentials(device.identifier)
        }
      }

      const confirmPair = await Confirm.prompt({
        message: 'Ready to start pairing?',
        default: true,
      })

      if (!confirmPair) {
        output.info('Pairing cancelled.')
        process.exit(0)
      }

      output.info('\n🔢 A 4-digit PIN will appear on your Apple TV screen.')
      output.info('   Please enter it below when it appears.\n')

      // Create protocol
      const protocolManager = new ProtocolManager()
      const companionProtocol = await protocolManager.createProtocol(device, storage)

      // Setup PIN prompt
      const onPinRequired = protocolManager.setupPinPrompt()

      // Start pairing
      output.startSpinner('Pairing in progress...')

      try {
        await protocolManager.connect(companionProtocol, {
          onPinRequired,
          timeout: 30000,
          autoRecover: false,
        })

        output.succeedSpinner('Pairing successful!')

        // Disconnect after pairing
        await protocolManager.disconnect(companionProtocol, 'Pairing complete')
      } catch (error) {
        output.failSpinner('Pairing failed')
        throw error
      }
    })

    // Step 4: Verify Credentials Saved
    output.section('Step 4: Verify Configuration')

    await withErrorHandling(output, async () => {
      const device = await deviceManager.findDevice(selectedDevice)
      const credentialsSaved = await credManager.hasCredentials(device.identifier)

      if (credentialsSaved) {
        output.success('✅ Credentials saved successfully!')
        output.info(`   Device: ${device.name}`)
        output.info(`   Identifier: ${device.identifier}`)
      } else {
        output.warn('⚠️  Warning: Credentials may not have been saved properly')
      }
    })

    // Step 5: Test Connection
    output.section('Step 5: Test Connection')

    const shouldTest = await Confirm.prompt({
      message: 'Would you like to test the connection?',
      default: true,
    })

    if (shouldTest) {
      await withErrorHandling(output, async () => {
        const device = await deviceManager.findDevice(selectedDevice)
        const protocolManager = new ProtocolManager()
        const companionProtocol = await protocolManager.createProtocol(device, storage)

        output.startSpinner('Testing connection...')

        try {
          await protocolManager.connect(companionProtocol, {
            timeout: 10000,
            autoRecover: false,
          })

          // Get device status to test
          const attentionState = await companionProtocol.getAttentionState()
          const volume = await companionProtocol.getVolume()

          output.succeedSpinner('Connection test successful!')
          output.info(`   Attention State: ${AttentionState[attentionState]}`)
          output.info(`   Volume: ${volume}%`)
          output.info('   Your Apple TV is ready to use.')

          // Disconnect
          await protocolManager.disconnect(companionProtocol, 'Test complete')
        } catch (error) {
          output.failSpinner('Connection test failed')
          output.error((error as Error).message)
        }
      })
    }

    // Complete
    output.section('🎉 Setup Complete!')
    output.info('You can now use the following commands:')
    output.listItem('bunatv discover - Find Apple TV devices')
    output.listItem(`bunatv pair ${selectedDevice} - Pair with a specific device`)
    output.listItem(`bunatv control ${selectedDevice} volume get - Get volume`)
    output.listItem(`bunatv control ${selectedDevice} remote select - Press select`)
    output.listItem(`bunatv control ${selectedDevice} status - Get device status`)
    output.info('\nEnjoy using BunATV!')
  })
