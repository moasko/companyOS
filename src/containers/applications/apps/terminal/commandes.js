// Commandes du Terminal CompanyOS.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUI CHANGE PAR RAPPORT À L'ANCIEN TERMINAL
//
// L'ancien naviguait dans `assets/dir.json` : un arbre Windows factice,
// figé dans le code, sans aucun rapport avec le cloud de l'espace de
// travail. `dir` listait des dossiers qui n'existaient pas, `cd` descendait
// dans du vide, et rien de ce qu'on y faisait n'avait d'effet. C'était un
// décor.
//
// Il exposait aussi `eval` : n'importe quelle ligne tapée était exécutée
// comme du JavaScript, dans un shell qui détient le jeton d'authentification
// de la session. Retiré, et remplacé par un calculateur qui ne sait
// qu'additionner.
//
// Ici, chaque commande agit sur les vraies données : les fichiers du cloud,
// les applications installées, les membres de l'espace. Une commande qui
// ment est pire qu'une commande absente.
// ─────────────────────────────────────────────────────────────────────────

import { api } from "../../../../api/client";
import { ouvrirFichier } from "../../../../apps/openRequest";
import { ouvrirFenetre } from "../../../../apps/windows";
import { envoyerA } from "../../../../apps/notifications";
import { modulesTous } from "../../../../apps/registry";
import { estOuvrable, familleDe } from "../../../../apps/fileTypes";

const formatOctets = (n) => {
  const o = Number(n) || 0;
  if (o < 1024) return `${o} o`;
  const unites = ["Ko", "Mo", "Go", "To"];
  let v = o;
  let u = -1;
  do {
    v /= 1024;
    u += 1;
  } while (v >= 1024 && u < unites.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${unites[u]}`;
};

const colonnes = (lignes, ecarts = 2) => {
  if (!lignes.length) return [];
  const largeurs = [];
  for (const l of lignes) {
    l.forEach((c, i) => {
      largeurs[i] = Math.max(largeurs[i] || 0, String(c ?? "").length);
    });
  }
  return lignes.map((l) =>
    l
      .map((c, i) =>
        i === l.length - 1
          ? String(c ?? "")
          : String(c ?? "").padEnd(largeurs[i] + ecarts),
      )
      .join(""),
  );
};

// ---------------------------------------------------------------------------
// Résolution de chemins
// ---------------------------------------------------------------------------
//
// Le chemin courant est une **pile** de { id, nom }, pas une chaîne. Une
// chaîne obligerait à retraverser l'arbre à chaque commande pour retrouver
// les identifiants — et deux dossiers peuvent porter le même nom dans deux
// branches différentes.

const CHEMIN_RACINE = [{ id: null, nom: "cloud" }];

export const cheminTexte = (pile) =>
  "/" + pile.slice(1).map((p) => p.nom).join("/");

/// Résout un chemin relatif ou absolu et rend la nouvelle pile, ou null.
const resoudre = async (pile, chemin) => {
  let courant = chemin.startsWith("/") ? [...CHEMIN_RACINE] : [...pile];
  const morceaux = chemin.split("/").filter((m) => m && m !== ".");

  for (const m of morceaux) {
    if (m === "..") {
      if (courant.length > 1) courant.pop();
      continue;
    }
    const contenu = await api.listFiles(courant[courant.length - 1].id);
    const dossier = contenu.find(
      (n) => n.type === "FOLDER" && n.name.toLowerCase() === m.toLowerCase(),
    );
    if (!dossier) return null;
    courant.push({ id: dossier.id, nom: dossier.name });
  }
  return courant;
};

/// Trouve un élément par nom dans le dossier courant.
const trouver = async (pile, nom) => {
  const contenu = await api.listFiles(pile[pile.length - 1].id);
  return (
    contenu.find((n) => n.name.toLowerCase() === nom.toLowerCase()) || null
  );
};

// ---------------------------------------------------------------------------
// Commandes
// ---------------------------------------------------------------------------
//
// Chaque commande reçoit un contexte et rend, éventuellement, une nouvelle
// pile de chemin. Elles n'écrivent jamais dans le DOM : elles appellent
// `ecrire`, ce qui les rend lisibles et testables.

export const COMMANDES = {
  aide: {
    resume: "liste les commandes disponibles",
    usage: "aide [commande]",
    alias: ["help", "?"],
    async executer({ args, ecrire }) {
      if (args[0]) {
        const nom = args[0].toLowerCase();
        const cmd =
          COMMANDES[nom] ||
          Object.values(COMMANDES).find((c) => c.alias?.includes(nom));
        if (!cmd) return ecrire(`Commande inconnue : ${args[0]}`, "erreur");
        ecrire(cmd.usage, "fort");
        ecrire(cmd.resume);
        if (cmd.alias?.length) ecrire(`Alias : ${cmd.alias.join(", ")}`, "faible");
        return;
      }

      const groupes = {
        Fichiers: ["ls", "cd", "pwd", "mkdir", "mv", "rm", "cat", "ouvrir", "quota", "corbeille"],
        "Espace de travail": ["qui", "membres", "notifier", "apps", "installer", "desinstaller"],
        Système: ["theme", "date", "version", "historique", "effacer", "quitter"],
      };

      ecrire("Terminal CompanyOS — les commandes agissent sur vos vraies données.", "faible");
      for (const [groupe, noms] of Object.entries(groupes)) {
        ecrire("");
        ecrire(groupe, "titre");
        colonnes(
          noms.filter((n) => COMMANDES[n]).map((n) => [n, COMMANDES[n].resume]),
        ).forEach((l) => ecrire("  " + l));
      }
      ecrire("");
      ecrire("« aide <commande> » pour le détail.", "faible");
    },
  },

  ls: {
    resume: "liste le dossier courant",
    usage: "ls [chemin] [-l]",
    alias: ["dir", "l"],
    async executer({ args, pile, ecrire }) {
      const detaille = args.includes("-l");
      const cible = args.find((a) => !a.startsWith("-"));
      const dans = cible ? await resoudre(pile, cible) : pile;
      if (!dans) return ecrire(`Dossier introuvable : ${cible}`, "erreur");

      const contenu = await api.listFiles(dans[dans.length - 1].id);
      if (!contenu.length) return ecrire("(vide)", "faible");

      // Dossiers d'abord, puis alphabétique : c'est l'ordre que tout le
      // monde attend, et il rend une longue liste parcourable.
      const tries = [...contenu].sort((a, b) => {
        if (a.type !== b.type) return a.type === "FOLDER" ? -1 : 1;
        return a.name.localeCompare(b.name, "fr");
      });

      if (!detaille) {
        tries.forEach((n) =>
          ecrire(n.name, n.type === "FOLDER" ? "dossier" : null),
        );
        return;
      }

      colonnes(
        tries.map((n) => [
          n.type === "FOLDER" ? "dossier" : "fichier",
          n.type === "FOLDER" ? "" : formatOctets(n.size),
          new Date(n.updatedAt).toLocaleDateString("fr-FR"),
          n.name,
        ]),
      ).forEach((l, i) =>
        ecrire(l, tries[i].type === "FOLDER" ? "dossier" : null),
      );
    },
  },

  cd: {
    resume: "change de dossier",
    usage: "cd <chemin>   ( .. remonte, / revient à la racine )",
    async executer({ args, pile, ecrire }) {
      if (!args[0]) return { pile: [...CHEMIN_RACINE] };
      const suivant = await resoudre(pile, args.join(" "));
      if (!suivant) {
        ecrire(`Dossier introuvable : ${args.join(" ")}`, "erreur");
        return;
      }
      return { pile: suivant };
    },
  },

  pwd: {
    resume: "affiche le chemin courant",
    usage: "pwd",
    async executer({ pile, ecrire }) {
      ecrire(cheminTexte(pile));
    },
  },

  mkdir: {
    resume: "crée un dossier",
    usage: "mkdir <nom>",
    async executer({ args, pile, ecrire }) {
      const nom = args.join(" ").trim();
      if (!nom) return ecrire("Indiquez un nom de dossier.", "erreur");
      await api.createFolder(nom, pile[pile.length - 1].id);
      ecrire(`Dossier « ${nom} » créé.`, "succes");
      return { rafraichir: true };
    },
  },

  mv: {
    resume: "renomme ou déplace un élément",
    usage: "mv <source> <destination>   ( destination : un nom, ou un dossier )",
    alias: ["renommer"],
    async executer({ args, pile, ecrire }) {
      if (args.length < 2) return ecrire("Usage : mv <source> <destination>", "erreur");
      const [source, ...reste] = args;
      const destination = reste.join(" ");

      const node = await trouver(pile, source);
      if (!node) return ecrire(`Introuvable : ${source}`, "erreur");

      // Si la destination est un dossier existant, on déplace ; sinon on
      // renomme. C'est le comportement de `mv` partout ailleurs, et il
      // évite d'avoir deux commandes pour un seul geste.
      const dossier = await resoudre(pile, destination);
      if (dossier) {
        await api.moveNode(node.id, dossier[dossier.length - 1].id);
        ecrire(`« ${node.name} » déplacé vers ${cheminTexte(dossier)}.`, "succes");
      } else {
        await api.renameNode(node.id, destination);
        ecrire(`« ${node.name} » renommé en « ${destination} ».`, "succes");
      }
      return { rafraichir: true };
    },
  },

  rm: {
    resume: "met à la corbeille (-f : supprime définitivement)",
    usage: "rm <nom> [-f]",
    alias: ["supprimer"],
    async executer({ args, pile, ecrire, confirmer }) {
      const definitif = args.includes("-f");
      const nom = args.filter((a) => a !== "-f").join(" ");
      if (!nom) return ecrire("Indiquez un nom.", "erreur");

      const node = await trouver(pile, nom);
      if (!node) return ecrire(`Introuvable : ${nom}`, "erreur");

      if (definitif) {
        // Irréversible : on demande, même au terminal. Un shell n'est pas
        // une excuse pour supprimer sans confirmation.
        const ok = await confirmer({
          title: "Supprimer définitivement",
          message: `Supprimer définitivement « ${node.name} » ?`,
          detail: "Les octets sont effacés du stockage. Aucun retour possible.",
          confirmLabel: "Supprimer",
          danger: true,
        });
        if (!ok) return ecrire("Annulé.", "faible");
        await api.deleteNode(node.id);
        await api.purgeNode(node.id);
        ecrire(`« ${node.name} » supprimé définitivement.`, "succes");
      } else {
        await api.deleteNode(node.id);
        ecrire(`« ${node.name} » mis à la corbeille.`, "succes");
      }
      return { rafraichir: true };
    },
  },

  cat: {
    resume: "affiche le contenu d'un fichier texte",
    usage: "cat <fichier>",
    alias: ["lire"],
    async executer({ args, pile, ecrire }) {
      const nom = args.join(" ");
      if (!nom) return ecrire("Indiquez un fichier.", "erreur");
      const node = await trouver(pile, nom);
      if (!node || node.type !== "FILE")
        return ecrire(`Fichier introuvable : ${nom}`, "erreur");

      // 256 Ko : au-delà, dérouler le contenu dans un terminal ne rend
      // service à personne — la fenêtre devient inutilisable.
      if (Number(node.size) > 256 * 1024)
        return ecrire(
          `Fichier trop volumineux (${formatOctets(node.size)}). Ouvrez-le avec « ouvrir ${node.name} ».`,
          "erreur",
        );

      const url = await api.streamUrl(node.id);
      const texte = await (await fetch(url)).text();
      // Un binaire lu comme du texte remplit l'écran de caractères de
      // contrôle : on le détecte plutôt que de saccager l'affichage.
      if (/[\x00-\x08\x0E-\x1F]/.test(texte.slice(0, 2000)))
        return ecrire("Ce fichier n'est pas du texte.", "erreur");

      texte.split("\n").slice(0, 500).forEach((l) => ecrire(l));
      if (texte.split("\n").length > 500)
        ecrire("… (500 premières lignes)", "faible");
    },
  },

  ouvrir: {
    resume: "ouvre un fichier ou une application",
    usage: "ouvrir <fichier|application>",
    alias: ["open"],
    async executer({ args, pile, ecrire }) {
      const cible = args.join(" ");
      if (!cible) return ecrire("Indiquez un fichier ou une application.", "erreur");

      const node = await trouver(pile, cible);
      if (node) {
        if (node.type === "FOLDER") {
          const suivant = await resoudre(pile, cible);
          ecrire(`Dossier ouvert : ${cheminTexte(suivant)}`, "faible");
          return { pile: suivant };
        }
        if (!estOuvrable(node))
          return ecrire(
            `Aucune application ne sait ouvrir « ${node.name} ».`,
            "erreur",
          );
        const contenu = await api.listFiles(pile[pile.length - 1].id);
        ouvrirFichier(node, contenu);
        ecrire(`« ${node.name} » ouvert dans ${familleDe(node).label}.`, "succes");
        return;
      }

      const app = modulesTous.find(
        (m) =>
          (m.id || "").toLowerCase() === cible.toLowerCase() ||
          (m.name || "").toLowerCase() === cible.toLowerCase(),
      );
      if (app) {
        ouvrirFenetre(app.id);
        return ecrire(`${app.name} ouvert.`, "succes");
      }

      ecrire(`Introuvable : ${cible}`, "erreur");
    },
  },

  quota: {
    resume: "espace de stockage utilisé",
    usage: "quota",
    alias: ["du"],
    async executer({ ecrire }) {
      const u = await api.usage();
      const utilise = Number(u.usedBytes);
      const total = Number(u.quota);
      const pct = total ? Math.round((utilise / total) * 100) : 0;
      const barres = Math.round(pct / 5);
      ecrire(`${formatOctets(utilise)} sur ${formatOctets(total)} — ${pct} %`);
      ecrire(
        "[" + "#".repeat(barres) + ".".repeat(20 - barres) + "]",
        pct > 90 ? "erreur" : pct > 75 ? "attention" : "succes",
      );
    },
  },

  corbeille: {
    resume: "liste la corbeille, ou restaure un élément",
    usage: "corbeille [restaurer <nom>]",
    async executer({ args, ecrire }) {
      const elements = await api.listTrash();

      if (args[0] === "restaurer") {
        const nom = args.slice(1).join(" ");
        const node = elements.find(
          (n) => n.name.toLowerCase() === nom.toLowerCase(),
        );
        if (!node) return ecrire(`Introuvable dans la corbeille : ${nom}`, "erreur");
        const r = await api.restoreNode(node.id);
        ecrire(`« ${node.name} » restauré.`, "succes");
        if (r.renommé) ecrire("Le nom d'origine était repris : il a été modifié.", "attention");
        if (r.remontéÀLaRacine)
          ecrire("Son dossier d'origine n'existe plus : replacé à la racine.", "attention");
        return { rafraichir: true };
      }

      if (!elements.length) return ecrire("La corbeille est vide.", "faible");
      colonnes(
        elements.map((n) => [
          n.type === "FOLDER" ? "dossier" : "fichier",
          formatOctets(n.size),
          new Date(n.deletedAt).toLocaleDateString("fr-FR"),
          n.name,
        ]),
      ).forEach((l) => ecrire(l));
      ecrire("");
      ecrire("« corbeille restaurer <nom> » pour récupérer un élément.", "faible");
    },
  },

  qui: {
    resume: "qui est connecté, et avec quel rôle",
    usage: "qui",
    alias: ["whoami"],
    async executer({ ecrire, session }) {
      if (session.status !== "authenticated") return ecrire("Non connecté.", "erreur");
      const roles = { OWNER: "Propriétaire", ADMIN: "Administrateur", MEMBER: "Membre" };
      ecrire(session.user.name, "fort");
      ecrire(session.user.email, "faible");
      ecrire(`${roles[session.user.role] || session.user.role} de « ${session.tenant.name} »`);
    },
  },

  membres: {
    resume: "liste les membres de l'espace de travail",
    usage: "membres",
    async executer({ ecrire }) {
      const roles = { OWNER: "Propriétaire", ADMIN: "Administrateur", MEMBER: "Membre" };
      const liste = await api.members();
      colonnes(
        liste.map((m) => [roles[m.role] || m.role, m.name, m.email]),
      ).forEach((l) => ecrire(l));
    },
  },

  notifier: {
    resume: "envoie une notification à un membre",
    usage: "notifier <e-mail|tous> <message>",
    async executer({ args, ecrire }) {
      if (args.length < 2) return ecrire("Usage : notifier <e-mail|tous> <message>", "erreur");
      const [cible, ...reste] = args;
      const message = reste.join(" ");

      let destinataire = "tous";
      if (cible.toLowerCase() !== "tous") {
        const liste = await api.members();
        const m = liste.find(
          (x) => x.email.toLowerCase() === cible.toLowerCase(),
        );
        if (!m) return ecrire(`Aucun membre avec l'adresse ${cible}.`, "erreur");
        destinataire = m.id;
      }

      const r = await envoyerA(destinataire, { source: "terminal", titre: message });
      if (!r) return ecrire("L'envoi a échoué.", "erreur");
      ecrire(`Envoyé à ${r.envoyees} personne(s).`, "succes");
    },
  },

  apps: {
    resume: "applications installées dans l'espace",
    usage: "apps [catalogue]",
    async executer({ args, ecrire }) {
      if (args[0] === "catalogue") {
        const cat = await api.catalog();
        colonnes(
          cat.map((a) => [a.installed ? "installée" : "", a.slug, a.name]),
        ).forEach((l, i) => ecrire(l, cat[i].installed ? "succes" : "faible"));
        return;
      }
      const liste = await api.installedApps();
      if (!liste.length) return ecrire("Aucune application installée.", "faible");
      colonnes(
        liste.map((a) => [a.slug, `v${a.installedVersion || a.version}`, a.name]),
      ).forEach((l) => ecrire(l));
    },
  },

  installer: {
    resume: "installe une application du catalogue",
    usage: "installer <identifiant>",
    async executer({ args, ecrire }) {
      const slug = args[0];
      if (!slug) return ecrire("Indiquez l'identifiant d'une application.", "erreur");
      const module = modulesTous.find((m) => m.slug === slug);
      await api.installApp(slug, module?.version);
      ecrire(`« ${slug} » installée.`, "succes");
      return { synchroniser: true };
    },
  },

  desinstaller: {
    resume: "retire une application de l'espace",
    usage: "desinstaller <identifiant>",
    async executer({ args, ecrire, confirmer }) {
      const slug = args[0];
      if (!slug) return ecrire("Indiquez l'identifiant d'une application.", "erreur");
      const ok = await confirmer({
        title: "Désinstaller l'application",
        message: `Retirer « ${slug} » de cet espace de travail ?`,
        detail: "Les données saisies sont conservées.",
        confirmLabel: "Désinstaller",
        danger: true,
      });
      if (!ok) return ecrire("Annulé.", "faible");
      await api.uninstallApp(slug);
      ecrire(`« ${slug} » désinstallée.`, "succes");
      return { synchroniser: true };
    },
  },

  theme: {
    resume: "bascule entre le thème clair et sombre",
    usage: "theme [clair|sombre]",
    async executer({ args, ecrire, basculerTheme }) {
      const voulu = args[0]?.toLowerCase();
      const actuel = basculerTheme(voulu);
      ecrire(`Thème ${actuel}.`, "succes");
    },
  },

  date: {
    resume: "date et heure",
    usage: "date",
    async executer({ ecrire }) {
      ecrire(
        new Date().toLocaleString("fr-FR", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    },
  },

  version: {
    resume: "version de CompanyOS",
    usage: "version",
    alias: ["ver"],
    async executer({ ecrire }) {
      ecrire("CompanyOS 0.1.0", "fort");
      ecrire(`${modulesTous.length} modules chargés`, "faible");
    },
  },

  historique: {
    resume: "commandes précédentes",
    usage: "historique",
    async executer({ ecrire, historique }) {
      if (!historique.length) return ecrire("Aucune commande.", "faible");
      historique.forEach((c, i) => ecrire(`${String(i + 1).padStart(3)}  ${c}`));
    },
  },

  echo: {
    resume: "affiche du texte",
    usage: "echo <texte>",
    async executer({ args, ecrire }) {
      ecrire(args.join(" "));
    },
  },

  calc: {
    resume: "calcul arithmétique",
    usage: "calc <expression>   ( + - * / ( ) )",
    async executer({ args, ecrire }) {
      const expr = args.join("");
      // Liste blanche stricte, puis évaluation par un analyseur maison.
      // L'ancien terminal faisait `eval(arg)` : n'importe quelle ligne tapée
      // s'exécutait comme du JavaScript, dans un shell qui détient le jeton
      // de session. Un calculateur n'a pas besoin de ce pouvoir.
      if (!/^[\d\s+\-*/().,]+$/.test(expr))
        return ecrire("Seuls les chiffres et + - * / ( ) sont acceptés.", "erreur");
      try {
        ecrire(String(evaluer(expr.replace(/,/g, "."))));
      } catch {
        ecrire("Expression invalide.", "erreur");
      }
    },
  },

  effacer: {
    resume: "vide l'écran",
    usage: "effacer",
    alias: ["clear", "cls"],
    async executer() {
      return { effacer: true };
    },
  },

  quitter: {
    resume: "ferme le terminal",
    usage: "quitter",
    alias: ["exit"],
    async executer() {
      return { quitter: true };
    },
  },
};

// ---------------------------------------------------------------------------
// Évaluateur arithmétique
// ---------------------------------------------------------------------------
//
// Descente récursive, une trentaine de lignes. C'est le prix à payer pour
// ne pas rappeler `eval` : il ne connaît que quatre opérateurs et des
// nombres, et ne peut rien atteindre d'autre.

const evaluer = (source) => {
  let i = 0;
  const blancs = () => {
    while (source[i] === " ") i += 1;
  };

  const expression = () => {
    let v = terme();
    for (;;) {
      blancs();
      const op = source[i];
      if (op !== "+" && op !== "-") return v;
      i += 1;
      const d = terme();
      v = op === "+" ? v + d : v - d;
    }
  };

  const terme = () => {
    let v = facteur();
    for (;;) {
      blancs();
      const op = source[i];
      if (op !== "*" && op !== "/") return v;
      i += 1;
      const d = facteur();
      if (op === "/" && d === 0) throw new Error("division par zéro");
      v = op === "*" ? v * d : v / d;
    }
  };

  const facteur = () => {
    blancs();
    if (source[i] === "(") {
      i += 1;
      const v = expression();
      blancs();
      if (source[i] !== ")") throw new Error("parenthèse");
      i += 1;
      return v;
    }
    if (source[i] === "-") {
      i += 1;
      return -facteur();
    }
    const debut = i;
    while (/[\d.]/.test(source[i] || "")) i += 1;
    if (debut === i) throw new Error("nombre attendu");
    return parseFloat(source.slice(debut, i));
  };

  const resultat = expression();
  blancs();
  if (i !== source.length) throw new Error("caractères en trop");
  return Math.round(resultat * 1e10) / 1e10;
};

/// Découpe une ligne en arguments, en respectant les guillemets.
///
/// Un découpage naïf sur les espaces rend le terminal inutilisable dès que
/// les fichiers ont des noms normaux : « ChatGPT Image 31 juil.png » devient
/// quatre arguments, et `mv` cherche un fichier nommé « ChatGPT ».
export const decouper = (ligne) => {
  const mots = [];
  let courant = "";
  let quote = null;
  let entame = false;

  for (const c of ligne) {
    if (quote) {
      if (c === quote) quote = null;
      else courant += c;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      // Une chaîne vide entre guillemets est un argument valide : sans ce
      // drapeau, `mv fichier ""` perdrait son second argument.
      entame = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (courant || entame) mots.push(courant);
      courant = "";
      entame = false;
      continue;
    }
    courant += c;
  }
  if (courant || entame) mots.push(courant);
  return mots;
};

/// Retrouve une commande par son nom ou l'un de ses alias.
export const trouverCommande = (nom) => {
  const n = (nom || "").toLowerCase();
  return (
    COMMANDES[n] || Object.values(COMMANDES).find((c) => c.alias?.includes(n)) || null
  );
};

/// Tous les noms saisissables, pour la complétion au tabulateur.
export const NOMS_COMMANDES = Object.entries(COMMANDES)
  .flatMap(([nom, c]) => [nom, ...(c.alias || [])])
  .sort();

export { formatOctets, resoudre, trouver, CHEMIN_RACINE };
