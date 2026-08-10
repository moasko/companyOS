// Historique du presse-papiers.
//
// L'historique reste **local au navigateur** : il n'est jamais envoyé au
// serveur. Ce qu'on copie contient souvent des mots de passe, des numéros
// de compte, des adresses — ça n'a rien à faire dans une base partagée, et
// encore moins dans un espace de travail à plusieurs. C'est un choix, pas
// un oubli : ne pas le synchroniser un jour sans y avoir réfléchi.

const CLE = "clipboard-history";
const MAX = 60;

let entrees = [];
const abonnes = new Set();

const charger = () => {
  try {
    entrees = JSON.parse(localStorage.getItem(CLE) || "[]");
  } catch {
    entrees = [];
  }
};

const ecrire = () => {
  try {
    localStorage.setItem(CLE, JSON.stringify(entrees));
  } catch {
    // Quota du navigateur atteint : on garde l'historique en mémoire
    // plutôt que de faire échouer la copie de l'utilisateur.
  }
  abonnes.forEach((fn) => fn([...entrees]));
};

charger();

export const subscribeClipboard = (fn) => {
  abonnes.add(fn);
  fn([...entrees]);
  return () => abonnes.delete(fn);
};

export const historique = () => [...entrees];

/// Ajoute un texte à l'historique. Un doublon remonte en tête au lieu de
/// s'empiler : recopier trois fois la même chose ne doit pas noyer le reste.
export const ajouterAuPressePapiers = (texte, origine = "") => {
  const valeur = (texte || "").trim();
  if (!valeur) return null;

  const existant = entrees.find((e) => e.texte === valeur);
  if (existant) {
    existant.date = Date.now();
    entrees = [existant, ...entrees.filter((e) => e !== existant)];
    ecrire();
    return existant;
  }

  const entree = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    texte: valeur,
    origine,
    date: Date.now(),
    epingle: false,
  };

  // On tronque, mais jamais les entrées épinglées : elles sont là parce
  // que l'utilisateur les a explicitement gardées.
  const suivantes = [entree, ...entrees];
  const epinglees = suivantes.filter((e) => e.epingle);
  const libres = suivantes.filter((e) => !e.epingle).slice(0, MAX - epinglees.length);
  entrees = [...suivantes.filter((e) => libres.includes(e) || e.epingle)];

  ecrire();
  return entree;
};

export const epingler = (id) => {
  const e = entrees.find((x) => x.id === id);
  if (!e) return;
  e.epingle = !e.epingle;
  ecrire();
};

export const retirer = (id) => {
  entrees = entrees.filter((e) => e.id !== id);
  ecrire();
};

/// Vide l'historique. Les entrées épinglées restent, sauf demande explicite.
export const vider = ({ toutSupprimer = false } = {}) => {
  entrees = toutSupprimer ? [] : entrees.filter((e) => e.epingle);
  ecrire();
};

/// Écoute les copies faites n'importe où dans l'OS.
///
/// L'événement `copy` ne porte pas toujours le texte (une copie native de
/// sélection le laisse vide) : on retombe alors sur la sélection courante.
export const ecouterLesCopies = () => {
  const surCopie = (e) => {
    const depuisEvenement = e.clipboardData?.getData("text/plain");
    const texte = depuisEvenement || window.getSelection()?.toString() || "";
    if (texte.trim()) ajouterAuPressePapiers(texte, nomDeLaFenetre(e.target));
  };

  document.addEventListener("copy", surCopie);
  document.addEventListener("cut", surCopie);
  return () => {
    document.removeEventListener("copy", surCopie);
    document.removeEventListener("cut", surCopie);
  };
};

/// D'où vient la copie — le nom de la fenêtre d'application la plus proche,
/// pour situer une entrée dans l'historique.
const nomDeLaFenetre = (element) => {
  const fenetre = element?.closest?.(".floatTab");
  return fenetre?.querySelector(".appFullName")?.textContent?.trim() || "";
};

/// Recopie une entrée dans le presse-papiers du système.
export const recopier = async (texte) => {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    // Certains navigateurs refusent l'écriture hors geste utilisateur :
    // on retombe sur la vieille méthode, qui marche partout.
    const zone = document.createElement("textarea");
    zone.value = texte;
    zone.style.cssText = "position:fixed;top:-1000px";
    document.body.appendChild(zone);
    zone.select();
    const ok = document.execCommand("copy");
    zone.remove();
    return ok;
  }
};
