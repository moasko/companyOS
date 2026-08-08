import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/// Catalogue de départ de la Boutique.
/// `isCore` = installé d'office à la création d'un espace de travail.
const apps = [
  {
    slug: "explorer",
    name: "Explorateur de fichiers",
    description: "Parcourir et gérer l'espace de stockage de l'entreprise.",
    icon: "explorer",
    category: "Système",
    kind: "NATIVE",
    isCore: true,
  },
  {
    slug: "settings",
    name: "Paramètres",
    description: "Configurer l'espace de travail, les comptes et l'apparence.",
    icon: "settings",
    category: "Système",
    kind: "NATIVE",
    isCore: true,
  },
  {
    slug: "store",
    name: "Boutique",
    description: "Installer de nouveaux modules de gestion.",
    icon: "store",
    category: "Système",
    kind: "NATIVE",
    isCore: true,
  },
  {
    slug: "terminal",
    name: "Terminal",
    description: "Console d'administration de l'espace de travail.",
    icon: "terminal",
    category: "Système",
    kind: "NATIVE",
    isCore: true,
  },
  {
    slug: "notepad",
    name: "Bloc-notes",
    description: "Prendre des notes rapides.",
    icon: "notepad",
    category: "Bureautique",
    kind: "NATIVE",
    isCore: true,
  },
  {
    slug: "calculator",
    name: "Calculatrice",
    description: "Calculs courants et conversions.",
    icon: "calculator",
    category: "Bureautique",
    kind: "NATIVE",
    isCore: true,
  },
  // Modules installables depuis la Boutique.
  {
    slug: "browser",
    name: "Navigateur",
    description:
      "Ouvrir les outils web de l'entreprise dans une fenêtre, avec des favoris partagés. Tout fichier téléchargé va dans le cloud de l'espace, pas sur la machine.",
    icon: "navigateur",
    category: "Outils",
    kind: "NATIVE",
  },
  {
    slug: "studio",
    name: "Studio",
    description:
      "Créer ses propres applications sans écrire de code, et les publier dans la Boutique de son espace de travail.",
    icon: "studio",
    category: "Outils",
    kind: "NATIVE",
  },
  {
    slug: "qrcode",
    name: "Générateur QR",
    description:
      "QR codes avancés : lien, Wi-Fi, carte de visite, e-mail, SMS. Couleurs, taille, correction d'erreur et historique partagé.",
    icon: "qrcode",
    category: "Outils",
    kind: "NATIVE",
  },
  {
    slug: "presentation",
    name: "Présentations",
    description:
      "Créez et projetez de vrais diaporamas PowerPoint (.pptx) : transitions, animations, notes du présentateur. Enregistrés dans le cloud de l'espace.",
    icon: "presentation",
    category: "Outils",
    kind: "NATIVE",
  },
  {
    slug: "word",
    name: "Traitement de texte",
    description:
      "Rédigez de vrais documents Word (.docx), paginés fidèlement, enregistrés dans le cloud de l'espace et ouvrables d'un double-clic depuis l'Explorateur.",
    icon: "winWord",
    category: "Outils",
    kind: "NATIVE",
  },
  // Modules dont le composant reste à écrire côté shell.
  {
    slug: "crm",
    name: "CRM",
    description: "Clients, contacts, opportunités et suivi commercial.",
    icon: "people",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "facturation",
    name: "Facturation",
    description: "Devis, factures, relances et suivi des règlements.",
    icon: "msoffice",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "stock",
    name: "Stock",
    description: "Articles, entrées/sorties et inventaire.",
    icon: "excel",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "rh",
    name: "Ressources humaines",
    description: "Salariés, contrats, congés et absences.",
    icon: "rh",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "achats",
    name: "Achats",
    description:
      "Commandez à vos fournisseurs, réceptionnez ligne à ligne, saisissez la facture : le stock monte tout seul et le poste fournisseurs se tient dans la Comptabilité. Suggestions de réappro sous le seuil.",
    icon: "achats",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "caisse",
    name: "Caisse",
    description:
      "Encaissez au comptoir : grille tactile des produits du Stock, rendu de monnaie calculé, paiement mixte espèces et mobile money, fermeture avec comptage du tiroir. Le stock et la comptabilité suivent tout seuls.",
    icon: "caisse",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "paie",
    name: "Paie",
    description:
      "Établissez les bulletins de salaire : barèmes CNPS et ITS de Côte d'Ivoire appliqués automatiquement, net à payer et coût employeur calculés. Les salariés viennent des RH, les écritures partent en Comptabilité.",
    icon: "paie",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "comptabilite",
    name: "Comptabilité",
    description:
      "Tenez votre comptabilité SYSCOHADA sans connaître un seul numéro de compte : choisissez ce que vous avez fait, le reste s'écrit tout seul. Vos factures deviennent des écritures d'un clic.",
    icon: "comptabilite",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "projets",
    name: "Projets",
    description: "Tâches, jalons et temps passé par projet.",
    icon: "todo",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "campagnes",
    name: "Campagnes",
    description:
      "L'email marketing sans se faire griller : audience choisie dans le CRM, message à variables, envoi cadencé par petits lots, lien de désinscription dans chaque courriel et statistiques d'envoi. Programmez pour lundi 8 h, l'OS s'en charge.",
    icon: "campagnes",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "courrier",
    name: "Courrier",
    description:
      "Écrivez à vos clients sans quitter l'OS : votre propre relais SMTP, des pièces jointes prises dans le cloud, et un historique de tout ce qui part. Les autres applications s'en servent aussi — une facture s'envoie par mail d'un clic.",
    icon: "courrier",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "signature",
    name: "Signature",
    description:
      "Dessinez votre signature une fois, gardez-la sous la main, et posez-la sur les PDF de votre cloud — devis acceptés, contrats, bons de livraison. La copie signée s'enregistre à côté, l'original n'est jamais modifié.",
    icon: "signature",
    category: "Gestion",
    kind: "NATIVE",
  },
  {
    slug: "agenda",
    name: "Agenda",
    description:
      "Toutes les dates de l'entreprise au même endroit : échéances de factures, tâches de projets, relances CRM, congés et fins de contrat, jours de paie s'y rassemblent automatiquement. Ajoutez vos propres rendez-vous ; chaque événement repris s'ouvre dans son application.",
    icon: "agenda",
    category: "Gestion",
    kind: "NATIVE",
  },
];

// Le catalogue global porte tenantId = null. Prisma refuse un null dans
// une clé unique composée, donc pas d'`upsert` ici : on cherche puis on
// crée ou met à jour.
for (const app of apps) {
  const existing = await prisma.app.findFirst({
    where: { tenantId: null, slug: app.slug },
  });

  if (existing) {
    // `isCore` explicitement remis à faux quand il est absent : une
    // application sortie du socle doit vraiment en sortir, or `update` ne
    // touche pas aux colonnes qu'on ne lui donne pas.
    await prisma.app.update({
      where: { id: existing.id },
      data: { ...app, isCore: app.isCore ?? false },
    });
  } else {
    await prisma.app.create({ data: app });
  }
}

console.log(`Catalogue initialisé : ${apps.length} applications.`);
await prisma.$disconnect();
