export const gene_name = () =>
  Math.random().toString(36).substring(2, 10).toUpperCase();

let installed = JSON.parse(localStorage.getItem("installed") || "[]");

// Socle de CompanyOS. Les modules métier viennent s'ajouter à cette liste,
// ou sont installés à la demande depuis la Boutique.
const apps = [
  {
    name: "Démarrer",
    icon: "home",
    type: "action",
    action: "STARTMENU",
  },
  {
    name: "Recherche",
    icon: "search",
    type: "action",
    action: "SEARCHMENU",
  },
  {
    name: "Paramètres",
    icon: "settings",
    type: "app",
    action: "SETTINGS",
  },
  {
    name: "Gestionnaire de tâches",
    icon: "taskmanager",
    type: "app",
    action: "TASKMANAGER",
  },
  {
    name: "Explorateur de fichiers",
    icon: "explorer",
    type: "app",
    action: "EXPLORER",
  },
  {
    name: "Terminal",
    icon: "terminal",
    type: "app",
    action: "TERMINAL",
  },
  {
    name: "Bloc-notes",
    icon: "notepad",
    type: "app",
    action: "NOTEPAD",
  },
  {
    name: "Calculatrice",
    icon: "calculator",
    type: "app",
    action: "CALCUAPP",
  },
  {
    name: "Boutique",
    icon: "store",
    type: "app",
    action: "WNSTORE",
  },
  // Les applications système (Photos, Musique, Vidéo, Presse-papiers) ne
  // figurent volontairement pas ici : elles se déclarent dans leur propre
  // dossier avec `systeme: true`, et le shell les monte au démarrage.
  // Le menu Démarrer les liste car il lit l'état du shell, pas ce fichier.
  {
    name: "Corbeille",
    icon: "bin0",
    type: "app",
  },
];

for (let i = 0; i < installed.length; i++) {
  installed[i].action = gene_name();
  apps.push(installed[i]);
}

export default apps;
