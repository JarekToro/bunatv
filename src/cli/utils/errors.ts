import type { CliOutput } from '@/cli/utils/output.ts'
import { DeviceNotFoundError, NoDevicesFoundError } from '@/cli/core/device-manager.ts'
import { NotPairedError } from '@/cli/utils/connection.ts'

/**
 * Handle errors from protocol operations and exit with appropriate code
 */
export function handleProtocolError(error: Error, output: CliOutput): never {
  // Device discovery errors
  if (error instanceof NoDevicesFoundError) {
    output.error('❌ No Apple TV devices found on network')
    output.info('   • Check devices are powered on')
    output.info('   • Check devices are on same network')
    output.info('   • Check firewall settings')
    process.exit(1)
  }

  if (error instanceof DeviceNotFoundError) {
    output.error(`❌ ${error.message}`)
    output.info('   Run: bunatv discover')
    process.exit(1)
  }

  // Pairing errors
  if (error instanceof NotPairedError) {
    output.error('❌ Device not paired')
    output.info(`   Run: bunatv pair <device>`)
    process.exit(1)
  }

  // Connection errors
  if (error.message.includes('timeout')) {
    output.error('❌ Connection timeout')
    output.info('   • Check device is on and connected')
    output.info('   • Check network connectivity')
    output.info('   • Try increasing timeout with --timeout')
    process.exit(1)
  }

  if (error.message.includes('refused')) {
    output.error('❌ Connection refused')
    output.info('   • Device may be offline')
    output.info('   • Check IP address is correct')
    process.exit(1)
  }

  // Authentication errors
  if (error.message.includes('pairing')) {
    output.error('❌ Pairing failed')
    output.info('   • Check PIN entered correctly')
    output.info('   • Pairing may be disabled on device')
    output.info('   • Try restarting device')
    process.exit(1)
  }

  if (error.message.includes('credentials')) {
    output.error('❌ Invalid credentials')
    output.info('   Re-pair with device:')
    output.info('   • bunatv pair <device> --force')
    process.exit(1)
  }

  // Generic error
  output.error(`❌ Error: ${error.message}`)
  if (output.isVerbose()) {
    output.debug(error.stack || '')
  }
  process.exit(1)
}

/**
 * Wrapper for command execution with standardized error handling
 */
export async function withErrorHandling<T>(output: CliOutput, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    handleProtocolError(error as Error, output)
  }
}
