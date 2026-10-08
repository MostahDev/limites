# limites

Plugin Claude (hooks de fonction) qui rend Claude conscient de vos limites d'abonnement :

- joint à chaque message, de façon invisible, le % utilisé de la limite de session (5 h) et hebdomadaire, avec le délai avant réinitialisation ;
- pendant une longue tâche (sans nouveau message), rappelle ces chiffres à Claude juste après une action, à chaque palier franchi (tous les 10 points dès 50 %, puis tous les 2 points dès 85 %) : Claude enregistre alors son avancement et prévient avant d'atteindre la limite ;
- Claude adapte sa façon de travailler au-delà de 70 % et 90 % ;
- ligne de statut « Session 45 % · Semaine 20 % » et alertes à 80 % et 95 %.

## Installation (Claude Code)

```
/plugin install limites --marketplace MostahDev/limites
```

Fonctionnalité « function hooks » en accès anticipé : peut changer d'une version à l'autre.
