import React, { useCallback, useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { ToolBar } from "../../../../utils/general";
import { useNomApp } from "../../../../utils/nomsApps";
import { modal } from "../../../../apps/modalRequest";
import { syncInstalledModules } from "../../../../apps/sync";
import { menuContextuel } from "../../../../apps/menuRequest";
import {
  NOMS_COMMANDES,
  cheminTexte,
  decouper,
  trouverCommande,
  CHEMIN_RACINE,
} from "./commandes";
import "./terminal.scss";

// Terminal CompanyOS.
//
// La fenêtre ne connaît aucune commande : elle lit une ligne, la donne à
// `commandes.js`, et affiche ce qui en revient. Tout ce qui est ici relève
// de l'interaction — historique, complétion, défilement, sélection.

const ACCUEIL = [
  { texte: "CompanyOS — Terminal", classe: "fort" },
  { texte: "Tapez « aide » pour la liste des commandes.", classe: "faible" },
  { texte: "" },
];

export const WnTerminal = () => {
  const nomApp = useNomApp();
  const wnapp = useSelector((state) => state.apps.terminal);
  const session = useSelector((state) => state.session);
  const theme = useSelector((state) => state.setting.person.theme);
  const dispatch = useDispatch();

  const [lignes, setLignes] = useState(ACCUEIL);
  const [saisie, setSaisie] = useState("");
  const [pile, setPile] = useState([...CHEMIN_RACINE]);
  const [historique, setHistorique] = useState([]);
  const [rang, setRang] = useState(-1);
  const [occupe, setOccupe] = useState(false);

  const zone = useRef(null);
  const champ = useRef(null);
  // L'annulation par Ctrl+C doit être lisible depuis une commande déjà
  // lancée : une ref, pas un état, sinon la commande voit la valeur figée
  // au moment de son démarrage.
  const annule = useRef(false);

  const invite = `${session.user?.name?.split(" ")[0]?.toLowerCase() || "invite"}@${
    session.tenant?.slug || "companyos"
  }:${cheminTexte(pile)}$`;

  const ecrire = useCallback((texte, classe) => {
    setLignes((l) => [...l, { texte: String(texte ?? ""), classe }]);
  }, []);

  // Le terminal suit toujours sa dernière ligne : un shell qui ne défile
  // pas oblige à faire défiler à la main après chaque commande.
  useEffect(() => {
    const el = zone.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lignes, occupe]);

  useEffect(() => {
    if (!wnapp?.hide) champ.current?.focus();
  }, [wnapp?.hide]);

  const basculerTheme = (voulu) => {
    const actuel = theme === "dark" ? "sombre" : "clair";
    const cible = voulu === "clair" || voulu === "sombre" ? voulu : actuel === "clair" ? "sombre" : "clair";
    // `STNGTHEME` attend la valeur voulue, pas une bascule : dispatché sans
    // charge utile, il posait `theme: undefined` et l'OS perdait son thème.
    if (cible !== actuel)
      dispatch({ type: "STNGTHEME", payload: cible === "sombre" ? "dark" : "light" });
    return cible;
  };

  const executer = async (ligne) => {
    const brut = ligne.trim();
    setLignes((l) => [...l, { texte: `${invite} ${brut}`, classe: "invite" }]);
    if (!brut) return;

    setHistorique((h) => (h[h.length - 1] === brut ? h : [...h, brut]));
    setRang(-1);

    const [nom, ...args] = decouper(brut);
    const commande = trouverCommande(nom);

    if (!commande) {
      ecrire(`Commande inconnue : ${nom}`, "erreur");
      // Suggestion sur le préfixe : une faute de frappe est plus fréquente
      // qu'une commande imaginaire, et retaper « aide » à chaque fois use.
      const proches = NOMS_COMMANDES.filter((c) => c.startsWith(nom.slice(0, 2)));
      if (proches.length) ecrire(`Vouliez-vous dire : ${proches.join(", ")} ?`, "faible");
      return;
    }

    if (session.status !== "authenticated") {
      return ecrire("Connectez-vous pour utiliser le terminal.", "erreur");
    }

    setOccupe(true);
    annule.current = false;
    try {
      const sortie = await commande.executer({
        args,
        pile,
        ecrire,
        session,
        historique,
        confirmer: modal.confirm,
        basculerTheme,
      });

      if (annule.current) return;
      if (sortie?.pile) setPile(sortie.pile);
      if (sortie?.effacer) setLignes([]);
      if (sortie?.quitter) dispatch({ type: "TERMINAL", payload: "close" });
      if (sortie?.rafraichir) dispatch({ type: "CLOUD_TOUCH" });
      if (sortie?.synchroniser) await syncInstalledModules();
    } catch (err) {
      // Une commande qui échoue ne doit pas tuer le terminal : on montre
      // l'erreur et on rend la main, comme n'importe quel shell.
      ecrire(err.message || "La commande a échoué.", "erreur");
    } finally {
      setOccupe(false);
    }
  };

  /// Complétion au tabulateur : commandes en premier mot, noms de fichiers
  /// ensuite. Un préfixe commun est complété d'un coup ; sinon on liste.
  const completer = async () => {
    const avant = saisie.slice(0, champ.current?.selectionStart ?? saisie.length);
    const mots = avant.split(/\s+/);
    const partiel = mots[mots.length - 1] || "";

    let candidats = [];
    if (mots.length <= 1) {
      candidats = NOMS_COMMANDES.filter((c) => c.startsWith(partiel.toLowerCase()));
    } else {
      const { api } = await import("../../../../api/client");
      const contenu = await api.listFiles(pile[pile.length - 1].id).catch(() => []);
      candidats = contenu
        .map((n) => n.name)
        .filter((n) => n.toLowerCase().startsWith(partiel.toLowerCase()));
    }

    if (!candidats.length) return;

    if (candidats.length === 1) {
      const complet = [...mots.slice(0, -1), candidats[0]].join(" ");
      setSaisie(complet + saisie.slice(avant.length));
      return;
    }

    // Plusieurs possibilités : on complète jusqu'au plus long préfixe
    // commun, puis on les liste. Compléter au hasard serait pire que rien.
    let prefixe = candidats[0];
    for (const c of candidats) {
      while (!c.toLowerCase().startsWith(prefixe.toLowerCase())) {
        prefixe = prefixe.slice(0, -1);
      }
    }
    if (prefixe.length > partiel.length) {
      setSaisie([...mots.slice(0, -1), prefixe].join(" ") + saisie.slice(avant.length));
    }
    setLignes((l) => [
      ...l,
      { texte: `${invite} ${saisie}`, classe: "invite" },
      { texte: candidats.join("   "), classe: "faible" },
    ]);
  };

  const surTouche = async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const ligne = saisie;
      setSaisie("");
      await executer(ligne);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      return completer();
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      if (!historique.length) return;
      e.preventDefault();
      const suivant =
        e.key === "ArrowUp"
          ? Math.min(rang + 1, historique.length - 1)
          : Math.max(rang - 1, -1);
      setRang(suivant);
      setSaisie(suivant < 0 ? "" : historique[historique.length - 1 - suivant]);
      return;
    }

    if (e.key === "c" && e.ctrlKey) {
      // Ctrl+C avec une sélection copie, comme partout ailleurs. Sans
      // sélection, il annule — c'est la convention des terminaux.
      if (window.getSelection()?.toString()) return;
      e.preventDefault();
      annule.current = true;
      setLignes((l) => [...l, { texte: `${invite} ${saisie}^C`, classe: "invite" }]);
      setSaisie("");
      setOccupe(false);
      return;
    }

    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLignes([]);
    }
  };

  if (!wnapp) return null;

  return (
    <div
      className="wnterm floatTab dpShad"
      data-size={wnapp.size}
      data-max={wnapp.max}
      style={{ ...(wnapp.size === "cstm" ? wnapp.dim : null), zIndex: wnapp.z }}
      data-hide={wnapp.hide}
      id={wnapp.icon + "App"}
    >
      <ToolBar
        app={wnapp.action}
        icon={wnapp.icon}
        size={wnapp.size}
        name={nomApp("terminal")}
      />
      <div
        className="windowScreen"
        onClick={() => champ.current?.focus()}
        onContextMenu={(e) =>
          menuContextuel(e, [
            {
              nom: "Copier",
              icone: "faCopy",
              desactive: !window.getSelection()?.toString(),
              action: () =>
                navigator.clipboard?.writeText(window.getSelection().toString()),
            },
            {
              nom: "Coller",
              icone: "faPaste",
              action: async () => {
                const t = await navigator.clipboard?.readText().catch(() => "");
                if (t) setSaisie((s) => s + t.replace(/\n/g, " "));
                champ.current?.focus();
              },
            },
            { separateur: true },
            { nom: "Effacer l'écran", icone: "faEraser", raccourci: "Ctrl+L", action: () => setLignes([]) },
            { nom: "Aide", icone: "faCircleQuestion", action: () => executer("aide") },
          ])
        }
      >
        <div className="termZone win11Scroll" ref={zone}>
          {lignes.map((l, i) => (
            <div key={i} className="termLigne" data-classe={l.classe}>
              {l.texte || " "}
            </div>
          ))}

          <div className="termSaisie">
            <span className="termInvite">{invite}</span>
            <input
              ref={champ}
              type="text"
              value={saisie}
              spellCheck={false}
              autoComplete="off"
              disabled={occupe}
              onChange={(e) => setSaisie(e.target.value)}
              onKeyDown={surTouche}
            />
            {occupe ? <span className="termOccupe">…</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default WnTerminal;
