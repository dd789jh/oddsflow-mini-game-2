declare module 'canvas-confetti' {
  export interface ConfettiOptions {
    particleCount?: number
    angle?: number
    spread?: number
    startVelocity?: number
    decay?: number
    ticks?: number
    origin?: { x?: number; y?: number }
    colors?: string[]
    shapes?: string[]
    scalar?: number
    shapeOptions?: {
      emoji?: {
        value: string[]
      }
    }
  }

  export default function confetti(options?: ConfettiOptions): void
}

