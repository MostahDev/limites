import { expect, test } from 'claude-code/testing'

import { aRappeler, heure, ligneStatut, palier, sectionPrompt, texteRappel } from '../hooks/register'

const now = Date.parse('2026-10-08T10:00:00Z')
const fenetres = [
  { kind: 'five_hour', percentUsed: 92.5, resetsAt: '2026-10-08T12:05:00Z' },
  { kind: 'seven_day', percentUsed: 41, resetsAt: '2026-10-11T14:00:00Z' },
]

test('le délai de réinitialisation est lisible en français', () => {
  expect(heure('2026-10-08T10:45:00Z', now)).toBe('dans 45 min')
  expect(heure('2026-10-08T12:05:00Z', now)).toBe('dans 2 h 05')
  expect(heure('2026-10-11T14:00:00Z', now)).toBe('dans 3 j 4 h')
  expect(heure(undefined, now)).toBe('à une heure inconnue')
})

test('la ligne de statut résume les deux limites', () => {
  expect(ligneStatut(fenetres)).toBe('Session 93 % · Semaine 41 %')
  expect(ligneStatut([])).toBe(undefined)
})

test('le prompt donne les chiffres et le conseil adapté', () => {
  const texte = sectionPrompt(fenetres, now)
  expect(texte).toContain('session (5 h) : 92.5 % utilisés, réinitialisation dans 2 h 05')
  expect(texte).toContain('hebdomadaire (7 j) : 41 %')
  expect(texte).toContain('presque à la limite')
  expect(sectionPrompt([{ kind: 'five_hour', percentUsed: 10 }], now)).toContain('Il reste de la marge')
})

test('rappel en cours de tâche : un rappel par palier franchi', () => {
  const f = (p: number) => ({ kind: 'five_hour', percentUsed: p, resetsAt: '2026-10-08T12:05:00Z' })
  expect(aRappeler([f(30)], {}).length).toBe(0)
  expect(aRappeler([f(52)], {}).length).toBe(1)
  expect(aRappeler([f(58)], { 'five_hour:2026-10-08T12:05:00Z': 52 }).length).toBe(0)
  expect(aRappeler([f(61)], { 'five_hour:2026-10-08T12:05:00Z': 58 }).length).toBe(1)
  expect(aRappeler([f(88)], { 'five_hour:2026-10-08T12:05:00Z': 86 }).length).toBe(1)
  expect(aRappeler([f(86.5)], { 'five_hour:2026-10-08T12:05:00Z': 85.2 }).length).toBe(0)
  expect(palier(73)).toBe(70)
  expect(palier(90)).toBe(89)
})

test('le rappel donne les chiffres et dit quand s’arrêter', () => {
  const t = texteRappel(fenetres, now)
  expect(t).toContain('session (5 h) 93 % (réinitialisation dans 2 h 05)')
  expect(t).toContain('enregistre l')
  expect(texteRappel([{ kind: 'five_hour', percentUsed: 96 }], now)).toContain('Arrête-toi')
})
