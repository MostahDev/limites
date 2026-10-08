import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Fenetre } from '../types'

const fenetres = atom({ plugin: 'limites', key: 'fenetres' } as const, [] as Fenetre[])
// Seuils déjà signalés, par fenêtre et date de réinitialisation, pour ne pas répéter l'alerte
const alertes = atom({ plugin: 'limites', key: 'alertes' } as const, [] as string[])

// Dernier pourcentage déjà rappelé à Claude pendant un tour, par fenêtre (type + réinitialisation)
const rappels = atom({ plugin: 'limites', key: 'rappels' } as const, {} as Record<string, number>)

const SEUILS = [80, 95]

// Paliers de rappel en cours de tour : tous les 10 points, puis tous les 2 points à partir de 85 %
export const palier = (p: number) => (p >= 85 ? 85 + Math.floor((p - 85) / 2) * 2 : Math.floor(p / 10) * 10)
export const cle = (f: Fenetre) => `${f.kind}:${f.resetsAt ?? ''}`

// Fenêtres dont le palier a monté depuis le dernier rappel (une nouvelle fenêtre repart de zéro)
export const aRappeler = (liste: Fenetre[], deja: Record<string, number>) =>
  liste.filter(f => {
    const avant = deja[cle(f)]
    return avant === undefined ? f.percentUsed >= 50 : palier(f.percentUsed) > palier(avant)
  })

export const texteRappel = (liste: Fenetre[], now: number) => {
  const max = Math.max(...liste.map(f => f.percentUsed))
  const chiffres = liste.map(f => `${nom(f.kind)} ${Math.round(f.percentUsed)} % (réinitialisation ${heure(f.resetsAt, now)})`).join(' · ')
  const conseil =
    max >= 95
      ? "Arrête-toi au prochain point stable : enregistre l'avancement (fichiers, doc du projet) pour pouvoir reprendre, et préviens l'utilisateur avant de continuer."
      : max >= 85
        ? "Termine l'étape en cours, enregistre l'avancement pour pouvoir reprendre si la limite tombe, préviens l'utilisateur et évite les étapes lourdes."
        : max >= 70
          ? "Consommation élevée : choisis l'approche la plus économe et enregistre régulièrement l'avancement."
          : 'Il reste de la marge.'
  return `Limites d'utilisation (mesure en cours de tâche) : ${chiffres}. ${conseil}`
}

const NOMS: Record<string, string> = {
  five_hour: 'session (5 h)',
  seven_day: 'hebdomadaire (7 j)',
}

const nom = (kind: string) => NOMS[kind] ?? kind

// Délai avant réinitialisation, en français (« dans 2 h 05 », « dans 3 j 4 h »)
export const heure = (iso: string | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN
  if (Number.isNaN(t)) return 'à une heure inconnue'
  const min = Math.max(0, Math.round((t - now) / 60000))
  if (min < 60) return `dans ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `dans ${h} h ${String(min % 60).padStart(2, '0')}`
  return `dans ${Math.floor(h / 24)} j ${h % 24} h`
}

export const ligneStatut = (liste: Fenetre[]) =>
  liste.length === 0
    ? undefined
    : liste.map(f => `${f.kind === 'five_hour' ? 'Session' : f.kind === 'seven_day' ? 'Semaine' : f.kind} ${Math.round(f.percentUsed)} %`).join(' · ')

export const sectionPrompt = (liste: Fenetre[], now: number) => {
  const lignes = liste.map(f => `- Limite ${nom(f.kind)} : ${f.percentUsed} % utilisés, réinitialisation ${heure(f.resetsAt, now)} (${f.resetsAt ?? 'date inconnue'}).`)
  const max = Math.max(...liste.map(f => f.percentUsed))
  const conseil =
    max >= 90
      ? "Tu es presque à la limite : privilégie les réponses courtes, évite les sous-agents, les longues recherches et les relectures complètes de gros fichiers, et préviens l'utilisateur avant une tâche lourde."
      : max >= 70
        ? "La consommation est élevée : choisis l'approche la plus économe en appels d'outils et signale à l'utilisateur si une tâche risque d'entamer fortement ce qui reste."
        : "Il reste de la marge ; travaille normalement."
  return [
    '# Limites d’utilisation de l’abonnement',
    "Dernière mesure des limites d'utilisation du compte (partagées entre toutes les conversations) :",
    ...lignes,
    conseil,
    "Si l'utilisateur demande où en sont ses limites, réponds avec ces chiffres.",
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    try {
      const { rateLimits } = await $.session.usage()
      if (rateLimits.length) await update($, fenetres, () => rateLimits.map(f => ({ ...f })))
      $.ui.status(ligneStatut(rateLimits))
    } catch {}
    return r
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const liste: Fenetre[] = e.rateLimits.map(f => ({ ...f }))
      await update($, fenetres, () => liste)
      $.ui.status(ligneStatut(liste))

      const now = await $.clock.now()
      const deja = await read($, alertes)
      const nouvelles: string[] = []
      for (const f of liste) {
        for (const s of SEUILS) {
          const cle = `${f.kind}:${f.resetsAt ?? ''}:${s}`
          if (f.percentUsed >= s && !deja.includes(cle)) {
            nouvelles.push(cle)
            $.ui.toast(`Limite ${nom(f.kind)} : ${Math.round(f.percentUsed)} % utilisés (réinitialisation ${heure(f.resetsAt, now)})`)
          }
        }
      }
      if (nouvelles.length) await update($, alertes, a => [...a, ...nouvelles].slice(-50))
    }
    return next(e)
  })

  // Pendant un long tour, l'utilisateur n'envoie pas de message : on rappelle les chiffres à
  // Claude juste après le résultat d'un outil, chaque fois qu'un palier est franchi.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (r.deny !== undefined) return r
    try {
      const liste = await read($, fenetres)
      const deja = await read($, rappels)
      const dus = aRappeler(liste, deja)
      if (!dus.length) return r
      await update($, rappels, a => {
        const n = { ...a }
        for (const f of dus) n[cle(f)] = f.percentUsed
        return n
      })
      return { ...r, context: [...(r.context ?? []), texteRappel(liste, await $.clock.now())] }
    } catch {
      return r
    }
  }).catch(($, e, next) => next(e))

  // Joint les chiffres à chaque message de l'utilisateur (invisible pour lui, lu par Claude)
  on('prompt.submit', async ($, e, next) => {
    const liste = await read($, fenetres)
    if (!liste.length) return next(e)
    const bloc = sectionPrompt(liste, await $.clock.now())
    return next({ ...e, context: [...(e.context ?? []), bloc] })
  }).catch(($, e, next) => next(e))
}
