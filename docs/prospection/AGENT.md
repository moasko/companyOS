# Agent de prospection : règles de fonctionnement

L'agent tourne chaque jour ouvré. Il travaille avec la boîte
**team@companyos.fr** (connecteur MCP Hostinger « comanyos_mails ») et
consigne chaque envoi dans [`envois.csv`](envois.csv). Toute personne qui
reprend la main sur la prospection lit ce fichier d'abord.

## Ce que fait chaque passage, dans cet ordre

1. **Lire la boîte de réception** depuis le dernier passage.
   - **Retour en erreur** (Mail Delivery, Undeliverable, adresse inconnue) : passer la ligne à `rebond` dans `envois.csv`. Ne jamais réécrire à cette adresse.
   - **« stop »**, désinscription, ou refus clair : passer à `stop`. Ne plus jamais écrire à cette adresse ni à son domaine.
   - **Réponse d'un humain** : passer à `répondu`, **ne pas répondre à sa place**, et le signaler en tête du rapport, avec un résumé et une suggestion de réponse. C'est un rendez-vous ou une vente : c'est au fondateur de répondre.
   - **Réponse automatique** (absence, accusé de réception) : ignorer.
2. **Relances** des envois `envoyé` sans réponse :
   - J+4 jours ouvrés après le premier email : une relance courte, en réponse au message d'origine (`inReplyTo` sur le message des Envoyés) ;
   - J+10 : un dernier message de clôture (« je ne vous relancerai plus ») ;
   - ensuite plus rien. L'étape (`premier`, `relance1`, `relance2`) est notée dans `envois.csv`.
3. **Nouveaux prospects** : **10 nouveaux emails par jour au maximum**, relances comprises dans un plafond total de 25 envois par jour.
   - Le secteur change à chaque passage : on prend, dans cette liste, celui qui suit le secteur des derniers nouveaux envois de `envois.csv`, et l'on revient au début après le dernier. Liste : cabinets comptables, commerces (quincailleries, supermarchés, boutiques), écoles privées, cliniques et pharmacies, transport et logistique, BTP et matériaux, hôtels et restaurants, agences et intégrateurs informatiques (partenaires), ONG et associations.
   - Les villes visées sont Abidjan en priorité, puis Bouaké, San-Pédro, Yamoussoukro, Korhogo et Daloa.
   - Recherche web : la page officielle de l'entreprise, ou un annuaire (AnnuaireCI, Pratik, annuaireidu.ci, abidjan4you).

## Qui on a le droit d'écrire

- **Seulement une adresse générique de l'entreprise, publiée par elle-même ou dans un annuaire professionnel** : `info@`, `contact@`, `hello@`, `admin@`… sur le domaine de l'entreprise.
- **Jamais** une adresse Gmail, Yahoo ou Hotmail au nom d'une personne, une adresse deviné à partir d'un format (`prenom.nom@`), ou une adresse masquée sur ZoomInfo, RocketReach ou ContactOut.
- **Jamais de particuliers**, et jamais de grande entreprise ou de groupe coté : CompanyOS vise les PME.
- **Avant tout envoi**, chercher l'adresse dans `envois.csv` et dans le dossier `INBOX.Sent`. Si l'entreprise ou son domaine a déjà été contacté, on n'envoie pas.

## Comment on écrit

- Expéditeur affiché : « L'équipe CompanyOS ». Signature : `L'équipe CompanyOS` · `https://companyos.fr · team@companyos.fr`.
- Texte brut, 150 à 250 mots, vouvoiement. **Une phrase sur l'entreprise** tirée de sa page (quartier, activité, ancienneté), puis 3 ou 4 bénéfices choisis pour son secteur, puis **une seule demande** : 15 minutes de démo.
- Modèles par segment : [`emails.md`](emails.md) et [`envois-vague-1.md`](envois-vague-1.md).
- **Deux blocs obligatoires** dans chaque email, premier comme relance : « Vos données sont à vous » (sécurité, sauvegarde, aucune donnée vendue ni partagée, export) et « Le cercle CompanyOS » (invitation choisie, 50 places, avantages). Le texte est dans `emails.md` § 7. Ne jamais aller au-delà de ce qui y est écrit.
- Pied de page obligatoire : « Vous ne souhaitez plus recevoir de message de notre part ? Répondez « stop », nous ne vous écrirons plus. »
- **Offres autorisées** (validées le 17/10/2026) : formule Découverte gratuite ; Pro à 15 000 F/mois pour 15 utilisateurs ; 6 mois de Pro offerts aux structures d'accompagnement et à leurs entrepreneurs ; commission de 20 % récurrente pour les cabinets et agences partenaires ; atelier gratuit ; Cercle des entreprises fondatrices (50 places, avantages de `emails.md` § 7). **Aucune autre promesse** : pas de remise, pas de fonction qui n'existe pas dans le dépôt.
- N'affirmer une fonction que si elle existe dans `apps/web/src/apps/modules/`.

## Fin de passage

- Mettre à jour `envois.csv` (et `prospects.csv` pour les nouvelles cibles), puis commiter et pousser sur la branche de travail.
- Rapport à l'utilisateur en 5 lignes au plus : réponses reçues (en premier), nombre d'envois, rebonds, secteur du jour.
- **Arrêt automatique** si le taux de rebond du jour dépasse 20 %, ou si Hostinger renvoie une erreur de quota ou de spam. Dans ce cas, prévenir l'utilisateur et ne plus rien envoyer.
