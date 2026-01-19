class RecoveryError extends Error {
  constructor(message: string, errors?: Error[]) {
    super(message)
    this.name = 'RecoveryError'
  }
}

// Reusable recovery logic
export class RecoveryManager {
  private attempts = 0
  private timer?: Timer
  private errors: Error[] = []

  private async run(fn: () => Promise<void>, options: { maxAttempts: number; delay: number }) {
    if (this.attempts >= options.maxAttempts) {
      const errors = [...this.errors]
      this.reset()
      throw new RecoveryError('Max recovery attempts reached', errors)
    }

    this.attempts++
    const delay = options.delay * Math.pow(2, this.attempts - 1)

    await new Promise(resolve => setTimeout(resolve, delay))
    await fn()
    this.reset()
  }

  async runWithRecovery(
    fn: () => Promise<void>,
    options: { maxAttempts: number; delay: number }
  ): Promise<void> {
    try {
      await this.run(fn, options)
    } catch (error) {
      this.errors.push(error instanceof Error ? error : new Error(String(error)))
      await this.runWithRecovery(fn, options)
    }
  }

  reset() {
    this.attempts = 0
    this.errors = []
    if (this.timer) clearTimeout(this.timer)
  }
}
