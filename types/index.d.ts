export type Fenetre = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    limites: { fenetres: Fenetre[]; alertes: string[]; rappels: Record<string, number> }
  }
}
