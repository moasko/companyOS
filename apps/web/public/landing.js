(function () {
  "use strict";

  /* ---- Dictionnaires ---- */
  var I18N = {
    fr: {
      "meta.titre": "CompanyOS — Le système d'exploitation de votre entreprise",
      "nav.bureau": "Le bureau", "nav.apps": "Applications", "nav.decouvrir": "Découvrir",
      "nav.tarifs": "Tarifs", "nav.faq": "Questions",
      "actions.connexion": "Se connecter", "actions.creer": "Créer mon espace",
      "heros.titre": "Pilotez toute votre entreprise <em>depuis un seul écran</em>",
      "heros.argument": "Facturation, caisse, stock, paie CNPS, comptabilité SYSCOHADA, courrier, campagnes : des applications qui se parlent, pensées pour les entreprises ivoiriennes.",
      "heros.essayer": "Essayer gratuitement →", "heros.voirApps": "Voir les applications",
      "heros.note": "Formule Découverte gratuite · sans carte bancaire",
      "carte.crm.nom": "CRM", "carte.crm.tempsReel": "· temps réel",
      "carte.crm.prospection": "Prospection", "carte.crm.negociation": "Négociation", "carte.crm.signe": "Signé",
      "carte.fact.nom": "Facturation", "carte.fact.encaisse": "Encaissé ce mois",
      "carte.flux.nom": "En arrière-plan",
      "carte.flux.l1": "Facture FA-0241 générée", "carte.flux.l2": "Stock mis à jour",
      "carte.flux.l3": "Écriture comptable proposée", "carte.flux.l4": "Gérant notifié",
      "bandeau": "Fini le cahier, les fichiers Excel éparpillés et les tickets perdus : <b>une facture émise met le stock à jour, propose son écriture comptable et se relance toute seule.</b>",
      "bureau.avant": "Un vrai bureau", "bureau.titre": "Voici votre bureau d'entreprise",
      "bureau.sous": "Des fenêtres, des icônes, une barre des tâches : vous savez déjà l'utiliser. Aucune formation, le premier réflexe est le bon.",
      "mock.titre": "CompanyOS — Tableau de bord", "mock.resume": "Résumé du jour",
      "mock.k1": "Encaissé", "mock.k2": "Factures en attente", "mock.k3": "Ruptures de stock", "mock.k4": "Congés à valider",
      "puce.reglee": "Facture FA-0241 réglée<small>+250 000 F · stock mis à jour</small>",
      "puce.relance": "Relance envoyée<small>Facture FA-0227 · 8 jours de retard</small>",
      "puce.bulletin": "Bulletin de paie prêt<small>Écriture comptable proposée</small>",
      "evidence.1.t": "Ouvrez. Empilez. Respirez.",
      "evidence.1.p": "La caisse à gauche, les factures à droite, l'agenda au milieu. Plus d'onglets perdus ni de fichiers introuvables.",
      "evidence.2.t": "Vous savez déjà l'utiliser.",
      "evidence.2.p": "Un bureau, des icônes, un menu démarrer, une barre des tâches. Quiconque a touché un ordinateur s'y retrouve.",
      "evidence.3.t": "Rien n'est isolé. Tout se parle.",
      "evidence.3.p": "Une vente devient une facture, qui ajuste un stock, qui nourrit la comptabilité. Tout est déjà relié.",
      "apps.avant": "La suite", "apps.titre": "Une application par besoin. Trente en tout.",
      "apps.sous": "Quelque chose à gérer ? Il y a une application pour ça. Vous l'installez en un clic depuis la Boutique, et elle connaît déjà les autres : le CRM nourrit les campagnes, les RH alimentent la paie, tout finit en comptabilité.",
      "apps.cta": "Ouvrir la Boutique →",
      "apps.note": "Aucune n'est facturée à part : elles sont toutes comprises dans l'abonnement.",
      "app.facturation.n": "Facturation", "app.facturation.d": "Devis, factures, règlements, relances automatiques",
      "app.caisse.n": "Caisse", "app.caisse.d": "Point de vente tactile, espèces et mobile money",
      "app.stock.n": "Stock", "app.stock.d": "Inventaire par mouvements, alertes de rupture",
      "app.achats.n": "Achats", "app.achats.d": "Commandes fournisseurs, réceptions, paiements",
      "app.compta.n": "Comptabilité", "app.compta.d": "SYSCOHADA sans connaître un numéro de compte",
      "app.paie.n": "Paie", "app.paie.d": "Bulletins CNPS et ITS de Côte d'Ivoire",
      "app.rh.n": "Ressources humaines", "app.rh.d": "Dossiers, contrats, absences",
      "app.conges.n": "Congés", "app.conges.d": "Demandes, validations, soldes de jours",
      "app.frais.n": "Notes de frais", "app.frais.d": "Reçu photographié, validation, remboursement",
      "app.crm.n": "CRM", "app.crm.d": "Clients, opportunités, relances",
      "app.courrier.n": "Courrier", "app.courrier.d": "Emails pro depuis votre domaine",
      "app.campagnes.n": "Campagnes", "app.campagnes.d": "Email marketing avec taux d'ouverture",
      "app.agenda.n": "Agenda", "app.agenda.d": "Toutes les échéances de l'entreprise, tout seul",
      "app.signature.n": "Signature", "app.signature.d": "Signez vos PDF, sans imprimer",
      "app.docs.n": "Documents", "app.docs.d": "Traitement de texte, vrais fichiers Word",
      "app.presentation.n": "Présentations", "app.presentation.d": "Diaporamas PowerPoint dans le navigateur",
      "app.studio.n": "Studio", "app.studio.d": "Créez vos propres applications, sans code",
      "app.cloud.n": "Cloud", "app.cloud.d": "Les fichiers de l'entreprise, partagés et sûrs",
      "chaine.avant": "La preuve", "chaine.titre": "Elle vend. Tout s'enchaîne.",
      "chaine.sous": "Une vente à la caisse, cinq applications au travail, zéro clic. Ce qui vous prenait une soirée se fait tout seul.",
      "maillon.1.t": "Vente encaissée <span class=\"etiquette\">Caisse</span>",
      "maillon.1.d": "Espèces + Orange Money sur le même ticket.",
      "maillon.2.t": "Stock déduit <span class=\"etiquette\">Stock</span>",
      "maillon.2.d": "Chaque article vendu sort de l'inventaire, à la pièce.",
      "maillon.3.t": "Écriture comptable proposée <span class=\"etiquette\">Comptabilité</span>",
      "maillon.3.d": "Journal de caisse SYSCOHADA, équilibré, prêt à valider.",
      "maillon.4.t": "Statistiques à jour <span class=\"etiquette\">Tableau de bord</span>",
      "maillon.4.d": "La recette du jour s'affiche sur le bureau du gérant.",
      "maillon.5.t": "Alerte de rupture envoyée <span class=\"etiquette\">Notifications</span>",
      "maillon.5.d": "Le riz 25 kg passe sous le seuil : l'acheteur est prévenu.",
      "demarrer.avant": "Démarrage", "demarrer.titre": "En route en dix minutes",
      "demarrer.sous": "Pas d'installation, pas de serveur, pas d'informaticien : un navigateur suffit.",
      "etape.1.t": "Créez votre espace",
      "etape.1.p": "Le nom de votre entreprise, une adresse email, et c'est ouvert. La formule Découverte est gratuite, sans carte bancaire.",
      "etape.2.t": "Invitez votre équipe",
      "etape.2.p": "Chacun reçoit son accès avec son rôle : le comptable voit la comptabilité, la caissière voit la caisse, le gérant voit tout.",
      "etape.3.t": "Travaillez, le reste suit",
      "etape.3.p": "Vendez, facturez, payez les salaires. Le stock, la comptabilité et les relances se tiennent à jour tout seuls, en arrière-plan.",
      "zoom1.titre": "La caisse encaisse, <em>le stock suit</em>",
      "zoom1.p": "Un point de vente tactile qui parle la langue du commerce ivoirien : espèces, Orange Money, Wave, MTN. Chaque ticket déstocke les articles vendus et finit en comptabilité, sans une seule ressaisie.",
      "zoom1.l1": "Espèces et mobile money sur le même ticket",
      "zoom1.l2": "Alerte quand un article approche de la rupture",
      "zoom1.l3": "La recette du jour, visible du bureau du gérant",
      "zoom1.fenetre": "Caisse — Ticket n° 184",
      "zoom1.a1": "Riz parfumé 25 kg × 2", "zoom1.a2": "Huile 5 L × 1", "zoom1.a4": "Espèces", "zoom1.total": "Total",
      "zoom1.puce": "Stock mis à jour<small>Riz 25 kg : reste 14</small>",
      "zoom2.titre": "La paie qui connaît <em>la CNPS</em>",
      "zoom2.p": "Salaire de base, primes, heures supplémentaires : CompanyOS calcule les cotisations CNPS et l'ITS avec les barèmes ivoiriens à jour, imprime le bulletin et propose l'écriture comptable qui va avec.",
      "zoom2.l1": "Barèmes CNPS et ITS de Côte d'Ivoire, déjà réglés",
      "zoom2.l2": "Le bulletin PDF prêt à remettre au salarié",
      "zoom2.l3": "L'écriture de paie proposée en un clic",
      "zoom2.fenetre": "Paie — Bulletin de mars",
      "zoom2.a1": "Salaire brut", "zoom2.a2": "CNPS salarié", "zoom2.total": "Net à payer",
      "zoom2.puce": "Écriture proposée<small>661 / 431 / 447 — équilibrée</small>",
      "pourquoi.avant": "D'ici", "pourquoi.titre": "Pensé pour ici, pas traduit d'ailleurs",
      "pourquoi.sous": "Ce que les logiciels importés ne font pas.",
      "point.1.t": "Les règles du pays, déjà dedans",
      "point.1.p": "Barèmes CNPS et ITS à jour, plan comptable SYSCOHADA, franc CFA partout, semaine de six jours. Un taux change par décret ? Il se règle dans l'application, pas dans une mise à jour.",
      "point.2.t": "Des applications qui se parlent",
      "point.2.p": "Un ticket de caisse déstocke. Un bulletin de paie propose son écriture. Une facture impayée se relance par email au bon moment. Personne ne ressaisit ce qu'un autre module sait déjà.",
      "point.3.t": "Toute l'équipe, chacun son rôle",
      "point.3.p": "Le gérant voit tout, la caissière voit la caisse, chaque salarié demande ses congés et soumet ses frais. Chaque action est tracée dans un journal inaltérable.",
      "chiffre.1": "applications incluses", "chiffre.2": "abonnement unique, tout compris",
      "chiffre.3": "en franc CFA, TTC", "chiffre.4": "installation — tout dans le navigateur",
      "securite.avant": "Confiance", "securite.titre": "Vos données, au coffre",
      "securite.sous": "Une entreprise vit de ses chiffres : ils sont protégés, tracés et à vous.",
      "garde.1.t": "Accès chiffrés",
      "garde.1.p": "Connexions sécurisées, mots de passe jamais stockés en clair, sessions qui expirent.",
      "garde.2.t": "Journal inaltérable",
      "garde.2.p": "Chaque action — qui, quoi, quand — est consignée dans un journal que personne ne peut réécrire.",
      "garde.3.t": "Rôles par utilisateur",
      "garde.3.p": "Les droits se règlent au serveur, pas à l'écran : chacun ne voit que ce que son rôle permet.",
      "garde.5.t": "Aucun format prisonnier",
      "garde.5.p": "Vos données vivent dans une base PostgreSQL ordinaire. Vous pouvez faire héberger le tout chez vous — vos fichiers sur votre propre serveur de stockage, voire sur le disque réseau de vos bureaux.",
      "garde.4.t": "Vos fichiers restent vôtres",
      "garde.4.p": "Factures, bulletins et documents s'exportent en PDF, Word ou Excel à tout moment.",
      "tarifs.avant": "Tarifs", "tarifs.titre": "Des tarifs sans surprise",
      "tarifs.sous": "Résiliable quand vous voulez. Règlement par mobile money ou virement.",
      "tarifs.note": "Conversion indicative — la facturation se fait en franc CFA (XOF).",
      "plan.gratuit": "Gratuit", "plan.mois": "/ mois",
      "plan.dec.nom": "Découverte", "plan.dec.p": "Pour essayer et gérer une très petite activité.",
      "plan.dec.l1": "Toutes les applications", "plan.dec.l2": "3 utilisateurs", "plan.dec.l3": "2 Go de stockage",
      "plan.dec.cta": "Commencer",
      "plan.pro.badge": "Le choix des PME", "plan.pro.p": "Pour une équipe qui travaille dedans tous les jours.",
      "plan.pro.l1": "Tout Découverte", "plan.pro.l2": "15 utilisateurs", "plan.pro.l3": "25 Go de stockage",
      "plan.pro.l4": "Journal d'activité complet", "plan.pro.cta": "Choisir Pro",
      "plan.ent.nom": "Entreprise", "plan.ent.p": "Pour une structure établie, sans se poser de questions.",
      "plan.ent.l1": "Tout Pro", "plan.ent.l2": "Utilisateurs illimités", "plan.ent.l3": "100 Go de stockage",
      "plan.ent.l4": "Accompagnement à la mise en route", "plan.ent.cta": "Nous contacter",
      "faq.titre": "Les questions qu'on nous pose",
      "faq.1.q": "Faut-il installer quelque chose ?",
      "faq.1.r": "Non. CompanyOS s'ouvre dans le navigateur, sur ordinateur comme sur téléphone. Vos données sont sur le serveur, pas sur une machine du bureau qui peut tomber en panne.",
      "faq.2.q": "Puis-je payer par mobile money ?",
      "faq.2.r": "Oui, l'abonnement se règle par Orange Money, Wave, MTN Money ou virement bancaire, en franc CFA.",
      "faq.3.q": "Je tiens tout sur Excel. Comment je migre ?",
      "faq.3.r": "Vos clients, produits et soldes s'importent depuis vos fichiers Excel. La formule Entreprise inclut un accompagnement à la mise en route pour faire la bascule avec vous.",
      "faq.4.q": "Mes employés verront-ils tout ?",
      "faq.4.r": "Non. Chaque utilisateur a un rôle, et les droits sont appliqués côté serveur : la caissière voit la caisse, le comptable la comptabilité, et seul le gérant voit l'ensemble.",
      "faq.5.q": "Et si j'arrête ?",
      "faq.5.r": "L'abonnement se résilie quand vous voulez, sans pénalité. Avant de partir, vous exportez vos données : factures en PDF, tableaux en Excel, documents en Word.",
      "faq.6.q": "La comptabilité est-elle vraiment SYSCOHADA ?",
      "faq.6.r": "Oui : plan comptable SYSCOHADA révisé, journaux, grand livre et balance. Et vous n'avez pas besoin de connaître les numéros de compte — les écritures se proposent toutes seules depuis les factures, la caisse et la paie.",
      "final.titre": "Votre entreprise mérite mieux qu'un cahier.",
      "final.cta": "Créer mon espace gratuit",
      "pied.gauche": "© CompanyOS — le système d'exploitation des PME."
    },
    en: {
      "meta.titre": "CompanyOS — The operating system for your business",
      "nav.bureau": "The desktop", "nav.apps": "Applications", "nav.decouvrir": "Discover",
      "nav.tarifs": "Pricing", "nav.faq": "FAQ",
      "actions.connexion": "Sign in", "actions.creer": "Create my workspace",
      "heros.titre": "Run your whole business <em>from a single screen</em>",
      "heros.argument": "Invoicing, point of sale, inventory, CNPS payroll, SYSCOHADA accounting, mail, campaigns: applications that talk to each other, built for Ivorian businesses.",
      "heros.essayer": "Try it for free →", "heros.voirApps": "See the applications",
      "heros.note": "Free Discovery plan · no credit card required",
      "carte.crm.nom": "CRM", "carte.crm.tempsReel": "· live",
      "carte.crm.prospection": "Prospecting", "carte.crm.negociation": "Negotiation", "carte.crm.signe": "Signed",
      "carte.fact.nom": "Invoicing", "carte.fact.encaisse": "Collected this month",
      "carte.flux.nom": "In the background",
      "carte.flux.l1": "Invoice FA-0241 generated", "carte.flux.l2": "Inventory updated",
      "carte.flux.l3": "Journal entry drafted", "carte.flux.l4": "Owner notified",
      "bandeau": "No more paper ledgers, scattered Excel files and lost receipts: <b>an issued invoice updates the stock, drafts its journal entry and chases payment on its own.</b>",
      "bureau.avant": "A real desktop", "bureau.titre": "Meet your company desktop",
      "bureau.sous": "Windows, icons, a taskbar: you already know how to use it. No training needed — your first instinct is the right one.",
      "mock.titre": "CompanyOS — Dashboard", "mock.resume": "Today at a glance",
      "mock.k1": "Collected", "mock.k2": "Invoices pending", "mock.k3": "Stock-outs", "mock.k4": "Leave to approve",
      "puce.reglee": "Invoice FA-0241 paid<small>+250,000 F · stock updated</small>",
      "puce.relance": "Reminder sent<small>Invoice FA-0227 · 8 days overdue</small>",
      "puce.bulletin": "Payslip ready<small>Journal entry drafted</small>",
      "evidence.1.t": "Open. Stack. Breathe.",
      "evidence.1.p": "The register on the left, invoices on the right, the calendar in the middle. No more lost tabs or missing files.",
      "evidence.2.t": "You already know how to use it.",
      "evidence.2.p": "A desktop, icons, a start menu, a taskbar. Anyone who has touched a computer feels at home.",
      "evidence.3.t": "Nothing is isolated. Everything talks.",
      "evidence.3.p": "A sale becomes an invoice, which adjusts the stock, which feeds the books. Everything is already connected.",
      "apps.avant": "The suite", "apps.titre": "One application per need. Thirty in all.",
      "apps.sous": "Something to manage? There is an app for it. You install it in one click from the Store, and it already knows the others: the CRM feeds the campaigns, HR feeds payroll, and everything lands in accounting.",
      "apps.cta": "Open the Store →",
      "apps.note": "None is billed separately: they are all included in the subscription.",
      "app.facturation.n": "Invoicing", "app.facturation.d": "Quotes, invoices, payments, automatic reminders",
      "app.caisse.n": "Point of sale", "app.caisse.d": "Touch-friendly register, cash and mobile money",
      "app.stock.n": "Inventory", "app.stock.d": "Movement-based stock, low-stock alerts",
      "app.achats.n": "Purchasing", "app.achats.d": "Supplier orders, receiving, payments",
      "app.compta.n": "Accounting", "app.compta.d": "SYSCOHADA without knowing an account number",
      "app.paie.n": "Payroll", "app.paie.d": "CNPS and ITS payslips for Côte d'Ivoire",
      "app.rh.n": "Human resources", "app.rh.d": "Employee files, contracts, absences",
      "app.conges.n": "Leave", "app.conges.d": "Requests, approvals, day balances",
      "app.frais.n": "Expenses", "app.frais.d": "Snap the receipt, approve, reimburse",
      "app.crm.n": "CRM", "app.crm.d": "Customers, opportunities, follow-ups",
      "app.courrier.n": "Mail", "app.courrier.d": "Professional email on your own domain",
      "app.campagnes.n": "Campaigns", "app.campagnes.d": "Email marketing with open rates",
      "app.agenda.n": "Calendar", "app.agenda.d": "Every company deadline, gathered automatically",
      "app.signature.n": "Signature", "app.signature.d": "Sign your PDFs, no printer needed",
      "app.docs.n": "Documents", "app.docs.d": "Word processing, real Word files",
      "app.presentation.n": "Presentations", "app.presentation.d": "PowerPoint slideshows in the browser",
      "app.studio.n": "Studio", "app.studio.d": "Build your own applications, no code",
      "app.cloud.n": "Cloud", "app.cloud.d": "Company files, shared and safe",
      "chaine.avant": "The proof", "chaine.titre": "She sells. Everything follows.",
      "chaine.sous": "One sale at the register, five applications at work, zero clicks. What used to take you an evening now happens on its own.",
      "maillon.1.t": "Sale collected <span class=\"etiquette\">Point of sale</span>",
      "maillon.1.d": "Cash + Orange Money on the same receipt.",
      "maillon.2.t": "Stock deducted <span class=\"etiquette\">Inventory</span>",
      "maillon.2.d": "Every item sold leaves the inventory, piece by piece.",
      "maillon.3.t": "Journal entry drafted <span class=\"etiquette\">Accounting</span>",
      "maillon.3.d": "SYSCOHADA cash journal, balanced, ready to approve.",
      "maillon.4.t": "Statistics refreshed <span class=\"etiquette\">Dashboard</span>",
      "maillon.4.d": "Today's takings appear on the owner's desktop.",
      "maillon.5.t": "Low-stock alert sent <span class=\"etiquette\">Notifications</span>",
      "maillon.5.d": "The 25 kg rice drops below the threshold: the buyer is warned.",
      "demarrer.avant": "Getting started", "demarrer.titre": "Up and running in ten minutes",
      "demarrer.sous": "No installation, no server, no IT staff: a browser is enough.",
      "etape.1.t": "Create your workspace",
      "etape.1.p": "Your company name, an email address, and it's open. The Discovery plan is free, no credit card required.",
      "etape.2.t": "Invite your team",
      "etape.2.p": "Everyone gets access with their role: the accountant sees the books, the cashier sees the register, the owner sees everything.",
      "etape.3.t": "Work — the rest follows",
      "etape.3.p": "Sell, invoice, pay salaries. Inventory, accounting and payment reminders keep themselves up to date in the background.",
      "zoom1.titre": "The register collects, <em>the stock follows</em>",
      "zoom1.p": "A touch-friendly point of sale that speaks the language of Ivorian commerce: cash, Orange Money, Wave, MTN. Every receipt deducts the items sold and lands in accounting, without a single re-entry.",
      "zoom1.l1": "Cash and mobile money on the same receipt",
      "zoom1.l2": "Alert when an item is close to running out",
      "zoom1.l3": "Today's takings, visible from the owner's desktop",
      "zoom1.fenetre": "Point of sale — Receipt no. 184",
      "zoom1.a1": "Fragrant rice 25 kg × 2", "zoom1.a2": "Oil 5 L × 1", "zoom1.a4": "Cash", "zoom1.total": "Total",
      "zoom1.puce": "Stock updated<small>Rice 25 kg: 14 left</small>",
      "zoom2.titre": "Payroll that knows <em>the CNPS</em>",
      "zoom2.p": "Base salary, bonuses, overtime: CompanyOS computes CNPS contributions and ITS with up-to-date Ivorian scales, prints the payslip and drafts the matching journal entry.",
      "zoom2.l1": "CNPS and ITS scales for Côte d'Ivoire, preconfigured",
      "zoom2.l2": "The PDF payslip ready to hand to the employee",
      "zoom2.l3": "The payroll entry drafted in one click",
      "zoom2.fenetre": "Payroll — March payslip",
      "zoom2.a1": "Gross salary", "zoom2.a2": "Employee CNPS", "zoom2.total": "Net pay",
      "zoom2.puce": "Entry drafted<small>661 / 431 / 447 — balanced</small>",
      "pourquoi.avant": "From here", "pourquoi.titre": "Built for here, not translated from elsewhere",
      "pourquoi.sous": "What imported software doesn't do.",
      "point.1.t": "The country's rules, built in",
      "point.1.p": "Up-to-date CNPS and ITS scales, the SYSCOHADA chart of accounts, CFA francs everywhere, a six-day week. A rate changes by decree? You adjust it in the app, not in a software update.",
      "point.2.t": "Applications that talk to each other",
      "point.2.p": "A register receipt deducts stock. A payslip drafts its entry. An unpaid invoice sends its own email reminder at the right time. Nobody re-types what another module already knows.",
      "point.3.t": "The whole team, each with their role",
      "point.3.p": "The owner sees everything, the cashier sees the register, every employee requests leave and submits expenses. Every action is recorded in a tamper-proof log.",
      "chiffre.1": "applications included", "chiffre.2": "single subscription, all inclusive",
      "chiffre.3": "in CFA francs, tax included", "chiffre.4": "installation — everything in the browser",
      "securite.avant": "Trust", "securite.titre": "Your data, in the vault",
      "securite.sous": "A business lives on its numbers: they are protected, traced and yours.",
      "garde.1.t": "Encrypted access",
      "garde.1.p": "Secure connections, passwords never stored in plain text, sessions that expire.",
      "garde.2.t": "Tamper-proof log",
      "garde.2.p": "Every action — who, what, when — is recorded in a log nobody can rewrite.",
      "garde.3.t": "Per-user roles",
      "garde.3.p": "Permissions are enforced on the server, not on the screen: everyone sees only what their role allows.",
      "garde.5.t": "No format holds you hostage",
      "garde.5.p": "Your data lives in an ordinary PostgreSQL database. You can have the whole thing hosted at your place — your files on your own storage server, or even on the network drive in your offices.",
      "garde.4.t": "Your files stay yours",
      "garde.4.p": "Invoices, payslips and documents export to PDF, Word or Excel at any time.",
      "tarifs.avant": "Pricing", "tarifs.titre": "Pricing without surprises",
      "tarifs.sous": "Cancel whenever you want. Pay by mobile money or bank transfer.",
      "tarifs.note": "Indicative conversion — billing is in CFA francs (XOF).",
      "plan.gratuit": "Free", "plan.mois": "/ month",
      "plan.dec.nom": "Discovery", "plan.dec.p": "To try it out and run a very small business.",
      "plan.dec.l1": "All applications", "plan.dec.l2": "3 users", "plan.dec.l3": "2 GB of storage",
      "plan.dec.cta": "Get started",
      "plan.pro.badge": "The SMB favourite", "plan.pro.p": "For a team that works in it every day.",
      "plan.pro.l1": "Everything in Discovery", "plan.pro.l2": "15 users", "plan.pro.l3": "25 GB of storage",
      "plan.pro.l4": "Full activity log", "plan.pro.cta": "Choose Pro",
      "plan.ent.nom": "Enterprise", "plan.ent.p": "For an established company, with no second thoughts.",
      "plan.ent.l1": "Everything in Pro", "plan.ent.l2": "Unlimited users", "plan.ent.l3": "100 GB of storage",
      "plan.ent.l4": "Guided onboarding", "plan.ent.cta": "Contact us",
      "faq.titre": "The questions we get asked",
      "faq.1.q": "Do I need to install anything?",
      "faq.1.r": "No. CompanyOS opens in the browser, on a computer or a phone. Your data lives on the server, not on an office machine that can break down.",
      "faq.2.q": "Can I pay with mobile money?",
      "faq.2.r": "Yes, the subscription can be paid with Orange Money, Wave, MTN Money or bank transfer, in CFA francs.",
      "faq.3.q": "I keep everything in Excel. How do I migrate?",
      "faq.3.r": "Your customers, products and balances import from your Excel files. The Enterprise plan includes guided onboarding to make the switch with you.",
      "faq.4.q": "Will my employees see everything?",
      "faq.4.r": "No. Every user has a role, and permissions are enforced server-side: the cashier sees the register, the accountant sees the books, and only the owner sees everything.",
      "faq.5.q": "What if I stop?",
      "faq.5.r": "Cancel whenever you want, with no penalty. Before you leave, you export your data: invoices as PDF, tables as Excel, documents as Word.",
      "faq.6.q": "Is the accounting really SYSCOHADA?",
      "faq.6.r": "Yes: the revised SYSCOHADA chart of accounts, journals, general ledger and trial balance. And you don't need to know account numbers — entries are drafted automatically from invoices, the register and payroll.",
      "final.titre": "Your business deserves better than a notebook.",
      "final.cta": "Create my free workspace",
      "pied.gauche": "© CompanyOS — the operating system for SMBs."
    }
  };

  /* ---- Devises : taux indicatifs, ancrés sur la parité fixe XOF/EUR ---- */
  var DEVISES = {
    XOF: { taux: 1 },
    EUR: { taux: 1 / 655.957 },
    USD: { taux: 1 / 600 }
  };

  function formatePrix(montantXof, devise, langue) {
    if (devise === "EUR") return Math.round(montantXof * DEVISES.EUR.taux) + " €";
    if (devise === "USD") return "$" + Math.round(montantXof * DEVISES.USD.taux);
    var n = montantXof.toLocaleString(langue === "fr" ? "fr-FR" : "en-US");
    return n + " F";
  }

  /* ---- Détection selon le lieu : langue du navigateur + fuseau horaire ---- */
  function detecteLangue() {
    var langues = navigator.languages || [navigator.language || "fr"];
    for (var i = 0; i < langues.length; i++) {
      var l = String(langues[i]).toLowerCase();
      if (l.indexOf("fr") === 0) return "fr";
      if (l.indexOf("en") === 0) return "en";
    }
    return "fr";
  }
  function detecteDevise() {
    var fuseau = "";
    try { fuseau = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
    if (fuseau.indexOf("Africa/") === 0) return "XOF";
    if (fuseau.indexOf("Europe/") === 0) return "EUR";
    if (fuseau) return "USD";
    return "XOF";
  }

  var etat = {
    langue: localStorage.getItem("cos_langue") || detecteLangue(),
    devise: localStorage.getItem("cos_devise") || detecteDevise()
  };

  function applique() {
    var dico = I18N[etat.langue] || I18N.fr;
    document.documentElement.lang = etat.langue;
    document.title = dico["meta.titre"];
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var cle = el.getAttribute("data-i18n");
      if (dico[cle] !== undefined) el.innerHTML = dico[cle];
    });
    document.querySelectorAll("[data-prix]").forEach(function (el) {
      var montant = Number(el.getAttribute("data-prix"));
      if (montant > 0) el.textContent = formatePrix(montant, etat.devise, etat.langue);
    });
    document.getElementById("noteDevise").hidden = etat.devise === "XOF";
    document.querySelectorAll("#choixLangue button").forEach(function (b) {
      b.dataset.actif = String(b.dataset.langue === etat.langue);
    });
    document.querySelectorAll("#choixDevise button").forEach(function (b) {
      b.dataset.actif = String(b.dataset.devise === etat.devise);
    });
  }

  document.getElementById("choixLangue").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    etat.langue = b.dataset.langue;
    localStorage.setItem("cos_langue", etat.langue);
    applique();
  });
  document.getElementById("choixDevise").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    etat.devise = b.dataset.devise;
    localStorage.setItem("cos_devise", etat.devise);
    applique();
  });

  applique();
})();
