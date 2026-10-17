# Prospection CompanyOS

Kit pour trouver les premiers clients et gagner en visibilité. Rédigé en
octobre 2026, à partir du produit tel qu'il est dans ce dépôt et d'une
recherche web.

| Fichier | Contenu |
| --- | --- |
| [`prospects.csv`](prospects.csv) | Liste de cibles, importable telle quelle dans le CRM de CompanyOS |
| [`emails.md`](emails.md) | Emails et messages WhatsApp prêts à envoyer, par segment, avec relances |
| [`envois-vague-1.md`](envois-vague-1.md) | Les 10 premiers emails, entièrement rédigés pour chaque destinataire |
| [`partenaires.md`](partenaires.md) | Programme partenaire pour cabinets comptables et intégrateurs |
| [`contenu.md`](contenu.md) | Publications LinkedIn et Facebook, fiche Google, communiqué de presse |

---

## 1. Diagnostic : pourquoi personne ne trouve CompanyOS aujourd'hui

1. **companyos.fr était invisible pour Google.** Le conteneur sert le même
   `robots.txt` à l'application et à la vitrine, et ce fichier contient
   `Disallow: /`. Résultat : une recherche sur « companyos.fr » ne renvoie
   rien. C'est corrigé dans ce commit (`robots-vitrine.txt`, `sitemap.xml`,
   règle dans `apps/web/nginx.conf`). **Après le déploiement**, il faut
   déclarer le site dans Google Search Console et y soumettre
   `https://companyos.fr/sitemap.xml`. Sans cette étape, l'indexation peut
   prendre des semaines.
2. **Aucun aperçu au partage.** Un lien collé dans WhatsApp, LinkedIn ou
   Facebook n'affichait aucune image. Or en Côte d'Ivoire, WhatsApp est le
   premier canal commercial. Ce commit ajoute une image de partage, les
   balises Twitter et des données structurées (prix en XOF).
3. **Aucun moyen de joindre l'équipe.** Le bouton « Nous contacter » de la
   formule Entreprise renvoie vers l'écran de connexion. Un prospect prêt à
   payer 45 000 F par mois ne trouve ni email, ni numéro, ni WhatsApp.
   → **À faire (je n'ai pas vos coordonnées)** : remplacer le lien
   `href="/?connexion"` de `plan.ent.cta` dans `apps/web/public/landing.html`
   par `https://wa.me/225XXXXXXXXXX?text=Bonjour%2C%20je%20souhaite%20une%20d%C3%A9mo%20de%20CompanyOS`,
   et ajouter ce même lien dans le pied de page.
4. **Le domaine en .fr cible la France, alors que le produit est ivoirien.**
   SYSCOHADA, CNPS, ITS, FCFA et mobile money : le marché, c'est la Côte
   d'Ivoire, puis l'UEMOA. Le .fr n'est pas bloquant, mais réservez
   `companyos.ci` (NIC.CI), même en simple redirection : ça rassure un
   gérant d'Abidjan, et ça aide le référencement local.
5. **Bug corrigé en passant** : l'import CSV du CRM plantait à chaque fois
   (`object is not iterable`). Il fallait qu'il marche pour charger
   `prospects.csv`.

## 2. Qui viser, dans cet ordre

Le produit a quatre points forts que les logiciels importés n'ont pas : la
caisse qui encaisse Orange Money, Wave et MTN sur le même ticket, la paie
CNPS et ITS, la comptabilité SYSCOHADA, et un prix en FCFA payable en mobile
money. On cible ceux pour qui ces quatre points comptent le plus.

| Priorité | Segment | Pourquoi | Offre d'appel |
| --- | --- | --- | --- |
| **1** | **Cabinets d'expertise comptable** (dont le Club des Jeunes Experts-comptables de l'OECCA-CI, plus de 115 membres) | Un cabinet suit 20 à 80 PME. Le convaincre, c'est un canal vers des dizaines de clients. Il gagne du temps : les écritures arrivent déjà proposées depuis la caisse, la facturation et la paie. | Programme partenaire (voir `partenaires.md`) |
| **2** | **Commerces avec caisse** : quincailleries, supérettes, boutiques, dépôts, pharmacies parapharmacie, boulangeries | La démo est parlante : une vente, et le stock, la compta et le tableau de bord suivent. Le mobile money est leur quotidien. | Découverte gratuite + installation offerte sur place |
| **3** | **PME de services de 5 à 50 salariés** : agences, transport, BTP, écoles privées, cliniques | La paie CNPS et ITS remplace le tableur, et les relances de factures automatiques rapportent du cash. | Pro 15 000 F, premier mois offert |
| **4** | **Structures d'accompagnement** : incubateurs, Agence CI PME, FIPME, CGECI, French Tech Abidjan | Elles ont des centaines de PME en portefeuille et cherchent des outils à recommander. | Licence offerte à leurs cohortes, en échange d'une présentation |

**Pas les particuliers.** CompanyOS est un outil de gestion d'entreprise.
Les auto-entrepreneurs et artisans, oui, mais via la formule gratuite et le
bouche-à-oreille, pas par démarchage.

## 3. Plan d'action sur 30 jours

### Semaine 1 : être trouvable

- [ ] Déployer ce commit, puis déclarer le site dans Google Search Console et y soumettre le sitemap
- [ ] Ajouter un lien WhatsApp sur la vitrine (voir le point 3 du diagnostic)
- [ ] Créer une fiche **Google Business Profile** « CompanyOS — logiciel de gestion », Abidjan (texte dans `contenu.md`)
- [ ] Créer une **page LinkedIn** et une **page Facebook** CompanyOS. En Côte d'Ivoire, Facebook touche les commerçants, LinkedIn touche les comptables et les DAF.
- [ ] Préparer une démo de 3 minutes en vidéo (écran + voix) : une vente à la caisse en Wave, et ses effets
- [ ] Créer dans CompanyOS un espace de démonstration rempli (le jeu de données des captures convient)

### Semaine 2 : premiers contacts

- [ ] Importer `prospects.csv` dans le CRM (Comptes → Importer un CSV)
- [ ] Envoyer les emails « Partenariat cabinet comptable » à 10 cabinets, puis appeler les cabinets 48 h après
- [ ] Écrire à l'OECCA-CI et à son Club des Jeunes Experts-comptables pour proposer un atelier gratuit d'une heure : « Automatiser la tenue SYSCOHADA de vos clients PME »
- [ ] Écrire aux incubateurs (Impact Hub Abidjan, Hub Ivoire Tech, Orange Fab, Seedspace) et à l'Agence CI PME
- [ ] Publier 3 posts (calendrier dans `contenu.md`)

### Semaine 3 : terrain

- [ ] **Tournée terrain** : 20 commerces sur une même zone (Yopougon Siporex, Adjamé, Cocody Deux-Plateaux), tablette en main, démo de la caisse en 2 minutes. Laisser un flyer avec un QR code vers la vitrine (le module « Codes QR » de CompanyOS le génère).
- [ ] Relancer tous les emails sans réponse (relance J+4)
- [ ] Envoyer le communiqué de presse à Digital Mag, CIO Mag, Abidjan.net, Fraternité Matin et l'AIP

### Semaine 4 : l'Ivoire Tech Forum (11-13 novembre 2026, Sofitel Hôtel Ivoire)

- [ ] Contacter l'organisation **dès maintenant** pour un stand start-up ou une prise de parole (email dans `emails.md`). C'est le principal salon tech du pays, avec des programmes d'accompagnement pour start-ups et PME tech. Même sans stand, y aller avec la démo sur téléphone et des cartes de visite QR.
- [ ] Faire le bilan : taux de réponse par segment, et concentrer le mois suivant sur le meilleur

### Objectifs réalistes à 30 jours

| Indicateur | Cible |
| --- | --- |
| Espaces créés (formule gratuite) | 40 |
| Démos faites | 15 |
| Cabinets partenaires signés | 2 |
| Clients payants (Pro ou Entreprise) | 5 |

## 4. Règles pour démarcher proprement

- **Écrire à des adresses professionnelles** (contact@, info@, ou le
  dirigeant pour un sujet lié à son métier), jamais à des adresses
  personnelles achetées ou aspirées. La loi ivoirienne n° 2013-450 sur les
  données personnelles s'applique, comme le RGPD si vous écrivez depuis la
  France.
- **Chaque email propose de se désinscrire**, et une demande de retrait est
  appliquée le jour même : marquer la fiche « Écarté » dans le CRM.
- **Envoyer depuis un vrai domaine** (`prenom@companyos.fr`) avec SPF, DKIM
  et DMARC configurés, au maximum 30 à 50 emails par jour au début, sinon
  le domaine finit en spam. Évitez d'envoyer les campagnes de prospection
  depuis le même domaine que les emails transactionnels de l'application.
- **WhatsApp** : premier message court, jamais de liste de diffusion à des
  inconnus. Le message est personnel, ou il n'est pas envoyé.

## Sources

- Ivoire Tech Forum 2026, dates : [Digital Mag](https://digitalmag.ci/cote-divoire-start-up-et-innovation-ivoire-tech-forum-2026-les-dates-connues/?amp=1)
- Club des Jeunes Experts-comptables de l'OECCA-CI : [CapMad](https://www.capmad.com/article/a-abidjan-lordre-des-experts-comptables-structure-la-releve-avec-le-club-des-jeunes-experts)
- Programme Catalyse 2026 (Impact Hub Abidjan, Hub Ivoire Tech) : [AIP](https://www.aip.ci/cote-divoire-aip-plus-de-500-entrepreneurs-cibles-par-le-programme-national-catalyse-2026/)
- Agence Côte d'Ivoire PME, programme « PME digital » : [Fraternité Matin](https://www.fratmat.info/index.php/economie/digitalisation-des-entreprises-l-agence-cote-d-ivoire-pme-en-premiere-ligne-d-un-important-projet)
- FIPME, partenariat avec la BNI : [AllAfrica](https://fr.allafrica.com/stories/202512160326.html)
- French Tech Abidjan : [AIP](https://www.aip.ci/cote-divoire-aip-la-french-tech-abidjan-initie-une-soiree-pour-dynamiser-la-communication-et-le-marketing-digital/)
- Concurrence paie (prix d'un éditeur local, 24 900 F/mois) : [Kolonell](https://kolonell.com/fr/blog/app-gestion-rh-paie-pme-cote-ivoire-2026)
- Fiches d'entreprises : [AnnuaireCI](https://annuaireci.com)
