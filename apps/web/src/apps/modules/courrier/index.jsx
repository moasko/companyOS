// Courrier.
//
// ─────────────────────────────────────────────────────────────────────────
// UN CLIENT DE MESSAGERIE, PAS UN FORMULAIRE
//
// Trois volets, comme les messageries professionnelles : les dossiers à
// gauche, la liste des messages au centre — avec recherche —, la lecture
// ou l'écriture à droite. Envoyés, échecs et brouillons se rangent
// chacun chez eux ; un message se relit tel qu'il est parti, se renvoie
// d'un clic.
//
// C'est aussi un **service** : n'importe quelle application appelle
// `composerCourriel({...})` (voir src/apps/courrielRequest.js) et cette
// fenêtre s'ouvre sur un brouillon prérempli, pièce jointe du cloud
// comprise. L'utilisateur relit, puis envoie — jamais d'envoi dans son dos.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { prendreBrouillon, surBrouillon } from "../../courrielRequest";
import { iconeDeFichier } from "../../iconesFichiers";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import * as D from "@companyos/shared/courrier";
import "./courrier.scss";

export const manifest = {
  id: "courrier",
  slug: "courrier",
  name: "Courrier",
  icon: "courrier",
  action: "COURRIERAPP",
  Window: CourrierApp,
};

const BROUILLON_VIDE = {
  a: "",
  cc: "",
  sujet: "",
  texte: "",
  pieces: [], // [{ id, nom }]
};

/// Les intégrations d'avant le pluriel envoient `pieceJointeId` /
/// `pieceJointeNom` : on les range dans `pieces` sans rien casser.
const normaliserBrouillon = (b = {}) => {
  const pieces = [...(b.pieces || [])];
  if (b.pieceJointeId) pieces.push({ id: b.pieceJointeId, nom: b.pieceJointeNom || "pièce jointe" });
  const { pieceJointeId, pieceJointeNom, ...reste } = b;
  return { ...BROUILLON_VIDE, ...reste, pieces };
};

function CourrierApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const estAdmin = ["OWNER", "ADMIN"].includes(session.user?.role);

  const [dossier, setDossier] = useState("envoyes"); // envoyes | echecs | brouillons | reglages
  const [envois, setEnvois] = useState([]);
  const [brouillons, setBrouillons] = useState([]);
  const [recherche, setRecherche] = useState("");
  const [selection, setSelection] = useState(null); // id de la fiche ouverte
  const [composition, setComposition] = useState(null); // brouillon en cours, ou null
  const [brouillonId, setBrouillonId] = useState(null); // fiche brouillon d'origine
  const [occupe, setOccupe] = useState(false);

  const [modeles, setModeles] = useState([]);

  const charger = useCallback(async () => {
    const [e, b, m] = await Promise.all([
      api.records.list(manifest.slug, "envois"),
      api.records.list(manifest.slug, "brouillons").catch(() => []),
      api.records.list(manifest.slug, "modeles").catch(() => []),
    ]);
    const parDate = (x, y) => (y.data.date || "").localeCompare(x.data.date || "");
    setEnvois(e.sort(parDate));
    setBrouillons(b.sort(parDate));
    setModeles(m.sort((x, y) => (x.data.nom || "").localeCompare(y.data.nom || "")));
  }, []);
  const etat = useChargement(ouvert, charger);

  // Un brouillon poussé par une autre app ouvre directement la composition.
  useEffect(() => {
    const appliquer = (b) => {
      if (!b) return;
      setComposition(normaliserBrouillon(b));
      setBrouillonId(null);
      setSelection(null);
    };
    appliquer(prendreBrouillon());
    return surBrouillon(appliquer);
  }, []);

  // ---- Les listes par dossier ---------------------------------------------

  const listes = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    const filtre = (r) =>
      !q ||
      [r.data.a, r.data.cc, r.data.sujet, r.data.extrait, r.data.texte]
        .join(" ")
        .toLowerCase()
        .includes(q);
    const filtreModele = (r) =>
      !q ||
      [r.data.nom, r.data.sujet, r.data.texte].join(" ").toLowerCase().includes(q);
    return {
      envoyes: envois.filter((r) => r.data.envoye !== false).filter(filtre),
      echecs: envois.filter((r) => r.data.envoye === false).filter(filtre),
      brouillons: brouillons.filter(filtre),
      modeles: modeles.filter(filtreModele),
    };
  }, [envois, brouillons, modeles, recherche]);

  const liste = listes[dossier] || [];
  const ouverte =
    [...envois, ...brouillons, ...modeles].find((r) => r.id === selection) || null;

  // ---- Actions ------------------------------------------------------------

  const nouveau = () => {
    setComposition({ ...BROUILLON_VIDE });
    setBrouillonId(null);
    setSelection(null);
  };

  const ouvrirFiche = (r) => {
    if (dossier === "brouillons") {
      setComposition(normaliserBrouillon(r.data));
      setBrouillonId(r.id);
      setSelection(null);
    } else {
      // Envoyés, échecs et modèles s'ouvrent dans le volet de droite.
      setSelection(r.id);
      setComposition(null);
    }
  };

  const enregistrerModele = async (id, donnees) => {
    setOccupe(true);
    try {
      if (id) {
        await api.records.update(manifest.slug, "modeles", id, donnees);
      } else {
        const fiche = await api.records.create(manifest.slug, "modeles", donnees);
        setSelection(fiche.id);
      }
      await etat.rafraichir();
      notifier({ titre: "Modèle enregistré", message: donnees.nom, app: "Courrier", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimerModele = async (r) => {
    const ok = await modal.confirm({
      title: "Supprimer ce modèle ?",
      message: `« ${r.data.nom} » ne sera plus proposé — les relances qui s'en servent repasseront au message par défaut.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "modeles", r.id);
    setSelection(null);
    await etat.rafraichir();
  };

  /// Applique un modèle au brouillon en cours — en préservant ce que
  /// l'utilisateur a déjà écrit, après confirmation.
  const appliquerModeleAuBrouillon = async (m) => {
    const b = composition;
    if ((b.sujet.trim() || b.texte.trim())) {
      const ok = await modal.confirm({
        title: `Appliquer « ${m.data.nom} » ?`,
        message: "Le sujet et le message en cours seront remplacés par le modèle.",
        confirmLabel: "Appliquer",
      });
      if (!ok) return;
    }
    setComposition((prev) => ({
      ...prev,
      sujet: m.data.sujet || "",
      texte: m.data.texte || "",
    }));
  };

  const renvoyer = (r) => {
    setComposition({
      ...BROUILLON_VIDE,
      a: r.data.a,
      cc: r.data.cc || "",
      sujet: r.data.sujet,
      texte: r.data.texte || "",
    });
    setBrouillonId(null);
    setSelection(null);
  };

  const enregistrerBrouillon = async (b) => {
    setOccupe(true);
    try {
      const donnees = { ...b, date: new Date().toISOString() };
      if (brouillonId) {
        await api.records.update(manifest.slug, "brouillons", brouillonId, donnees);
      } else {
        const fiche = await api.records.create(manifest.slug, "brouillons", donnees);
        setBrouillonId(fiche.id);
      }
      await etat.rafraichir();
      notifier({ titre: "Brouillon enregistré", message: b.sujet || "Sans sujet", app: "Courrier", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimerBrouillon = async (r) => {
    const ok = await modal.confirm({
      title: "Supprimer ce brouillon ?",
      message: `« ${r.data.sujet || "Sans sujet"} » sera retiré.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "brouillons", r.id);
    await etat.rafraichir();
  };

  const envoyer = async (b) => {
    if (!D.pretAEnvoyer(b)) return;
    setOccupe(true);
    try {
      await api.courrierEnvoyer({
        a: D.adressesDe(b.a).join(", "),
        cc: D.adressesDe(b.cc).join(", ") || undefined,
        sujet: b.sujet.trim(),
        texte: b.texte,
        piecesJointes: b.pieces.length ? b.pieces.map((p) => p.id) : undefined,
      });
      // Un brouillon envoyé a fini sa vie de brouillon.
      if (brouillonId) {
        await api.records.remove(manifest.slug, "brouillons", brouillonId).catch(() => {});
      }
      setComposition(null);
      setBrouillonId(null);
      await etat.rafraichir();
      setDossier("envoyes");
      notifier({
        titre: "Courriel envoyé",
        message: `À ${D.adressesDe(b.a).join(", ")}.`,
        app: "Courrier",
        ton: "success",
      });
    } catch (e) {
      modal.alert({ title: "Envoi impossible", message: e.message, tone: "error" });
      await etat.rafraichir();
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="crrApp">
        <div className="crrVerrou">Connectez-vous pour écrire à vos clients.</div>
      </ModuleWindow>
    );
  }

  const DOSSIERS = [
    { id: "envoyes", label: "Envoyés", icone: "faPaperPlane", compte: listes.envoyes.length },
    { id: "echecs", label: "Échecs", icone: "faTriangleExclamation", compte: listes.echecs.length },
    { id: "brouillons", label: "Brouillons", icone: "faFileLines", compte: listes.brouillons.length },
    { id: "modeles", label: "Modèles", icone: "faClone", compte: listes.modeles.length },
  ];

  return (
    <ModuleWindow manifest={manifest} className="crrApp">
      <div className="crrShell">
        {/* ---- Rail des dossiers ---- */}
        <aside className="crrRail">
          <div className="crrNouveau">
            <Bouton icone="faPenToSquare" onClick={nouveau}>
              Nouveau message
            </Bouton>
          </div>
          {DOSSIERS.map((d) => (
            <div
              key={d.id}
              className="crrDossier handcr"
              data-actif={dossier === d.id}
              onClick={() => {
                setDossier(d.id);
                setSelection(null);
              }}
            >
              <Icon fafa={d.icone} width={13} />
              <span className="crrDossierNom">{d.label}</span>
              {d.compte ? <span className="crrDossierCompte">{d.compte}</span> : null}
            </div>
          ))}
          <div className="crrRailFin">
            {estAdmin ? (
              <div
                className="crrDossier handcr"
                data-actif={dossier === "reglages"}
                onClick={() => setDossier("reglages")}
              >
                <Icon fafa="faGear" width={13} />
                <span className="crrDossierNom">Réglages</span>
              </div>
            ) : null}
          </div>
        </aside>

        {dossier === "reglages" ? (
          <div className="crrLecture cosScroll">
            <Reglages modeles={modeles} />
          </div>
        ) : (
          <>
            {/* ---- Liste des messages ---- */}
            <section className="crrListe">
              <div className="crrRecherche">
                <Icon fafa="faMagnifyingGlass" width={11} />
                <input
                  value={recherche}
                  placeholder="Rechercher dans le courrier"
                  onChange={(e) => setRecherche(e.target.value)}
                />
                {recherche ? (
                  <span className="crrEffacer handcr" onClick={() => setRecherche("")}>
                    <Icon fafa="faXmark" width={10} />
                  </span>
                ) : null}
              </div>

              {dossier === "modeles" ? (
                <div
                  className="crrNouveauModele handcr"
                  onClick={() => setSelection("nouveau-modele")}
                >
                  <Icon fafa="faPlus" width={11} />
                  <span>Nouveau modèle</span>
                </div>
              ) : null}

              <div className="crrMessages cosScroll">
                <Contenu
                  etat={etat}
                  vide={!liste.length}
                  lignes={5}
                  rendreVide={() => (
                    <div className="crrListeVide">
                      {recherche
                        ? "Aucun message ne correspond."
                        : dossier === "brouillons"
                          ? "Aucun brouillon."
                          : dossier === "modeles"
                            ? "Aucun modèle. Créez-en un : relances, devis, confirmations…"
                            : dossier === "echecs"
                              ? "Aucun échec d'envoi — tant mieux."
                              : "Rien d'envoyé pour l'instant."}
                    </div>
                  )}
                >
                  {dossier === "modeles"
                    ? liste.map((r) => (
                        <div
                          key={r.id}
                          className="crrMessage handcr"
                          data-actif={selection === r.id}
                          onClick={() => ouvrirFiche(r)}
                        >
                          <span className="crrPastille crrPastilleModele">
                            <Icon fafa="faClone" width={12} />
                          </span>
                          <div className="crrMessageCorps">
                            <div className="crrMessageA">{r.data.nom}</div>
                            <div className="crrMessageSujet">{r.data.sujet}</div>
                            <div className="crrMessageExtrait">
                              {D.extraitDe(r.data.texte, 70)}
                            </div>
                          </div>
                        </div>
                      ))
                    : liste.map((r) => (
                    <div
                      key={r.id}
                      className="crrMessage handcr"
                      data-actif={selection === r.id || brouillonId === r.id}
                      data-echec={r.data.envoye === false}
                      onClick={() => ouvrirFiche(r)}
                    >
                      <span
                        className="crrPastille"
                        style={{ background: D.teinteDe(r.data.a) }}
                      >
                        {D.initialesDe(r.data.a)}
                      </span>
                      <div className="crrMessageCorps">
                        <div className="crrMessageHaut">
                          <span className="crrMessageA">{r.data.a || "(sans destinataire)"}</span>
                          <span className="crrMessageDate">{D.dateEnvoi(r.data.date)}</span>
                        </div>
                        <div className="crrMessageSujet">
                          {r.data.sujet || "(sans sujet)"}
                          {r.data.pieceJointe ? (
                            <Icon fafa="faPaperclip" width={9} />
                          ) : null}
                        </div>
                        <div className="crrMessageExtrait">
                          {D.extraitDe(r.data.extrait || r.data.texte, 70)}
                        </div>
                      </div>
                    </div>
                  ))}
                </Contenu>
              </div>
            </section>

            {/* ---- Lecture / composition ---- */}
            <section className="crrLecture cosScroll">
              {composition ? (
                <Composeur
                  brouillon={composition}
                  setBrouillon={setComposition}
                  occupe={occupe}
                  modeles={modeles}
                  onModele={appliquerModeleAuBrouillon}
                  onEnvoyer={() => envoyer(composition)}
                  onBrouillon={() => enregistrerBrouillon(composition)}
                  onFermer={() => {
                    setComposition(null);
                    setBrouillonId(null);
                  }}
                />
              ) : dossier === "modeles" && (selection === "nouveau-modele" || ouverte) ? (
                <ModeleEditeur
                  key={selection}
                  fiche={selection === "nouveau-modele" ? null : ouverte}
                  occupe={occupe}
                  onEnregistrer={(donnees) =>
                    enregistrerModele(selection === "nouveau-modele" ? null : ouverte.id, donnees)
                  }
                  onSupprimer={
                    selection === "nouveau-modele" ? null : () => supprimerModele(ouverte)
                  }
                />
              ) : ouverte ? (
                <Lecture
                  fiche={ouverte}
                  estBrouillon={dossier === "brouillons"}
                  onRenvoyer={() => renvoyer(ouverte)}
                  onSupprimer={
                    dossier === "brouillons" ? () => supprimerBrouillon(ouverte) : null
                  }
                />
              ) : (
                <div className="crrAccueil">
                  <Icon src="courrier" width={54} />
                  <div className="crrAccueilTitre">Le courrier de l'entreprise</div>
                  <p>
                    Choisissez un message pour le relire, ou écrivez-en un
                    nouveau. Tout ce qui part d'ici — et des autres
                    applications — reste archivé à gauche.
                  </p>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Lecture d'un message envoyé
// ---------------------------------------------------------------------------

const Lecture = ({ fiche, estBrouillon, onRenvoyer, onSupprimer }) => {
  const d = fiche.data;
  return (
    <div className="crrLectureCorps">
      <div className="crrBarreCommandes">
        <Bouton variante="secondaire" icone="faShare" onClick={onRenvoyer}>
          {estBrouillon ? "Reprendre" : "Renvoyer"}
        </Bouton>
        {onSupprimer ? (
          <Bouton variante="secondaire" icone="faTrashCan" onClick={onSupprimer}>
            Supprimer
          </Bouton>
        ) : null}
      </div>

      <h2 className="crrLectureSujet">{d.sujet || "(sans sujet)"}</h2>

      <div className="crrLectureTete">
        <span className="crrPastille crrPastilleGrande" style={{ background: D.teinteDe(d.a) }}>
          {D.initialesDe(d.a)}
        </span>
        <div className="crrLectureQui">
          <div className="crrLectureA">À : {d.a}</div>
          {d.cc ? <div className="crrLectureCc">Cc : {d.cc}</div> : null}
          <div className="crrLectureDate">{D.dateEnvoi(d.date)}</div>
        </div>
        {d.auto ? <span className="crrEtiquetteAuto">{d.auto}</span> : null}
        {d.envoye === false ? (
          <span className="crrEtiquetteEchec">Refusé par le relais</span>
        ) : d.envoye === true ? (
          <span className="crrEtiquetteOk">
            <Icon fafa="faCircleCheck" width={11} /> Envoyé
          </span>
        ) : null}
      </div>

      {d.erreur ? <Notice ton="erreur">{d.erreur}</Notice> : null}

      {(d.pieces?.length ? d.pieces : d.pieceJointe ? [d.pieceJointe] : []).length ? (
        <div className="crrPieces crrPiecesLecture">
          {(d.pieces?.length ? d.pieces : [d.pieceJointe]).map((nom) => (
            <div key={nom} className="crrPieceChip">
              <Icon fafa="faPaperclip" width={11} />
              <span>{nom}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="crrLectureTexte">{d.texte || d.extrait || ""}</div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Éditeur de modèle
// ---------------------------------------------------------------------------

const ModeleEditeur = ({ fiche, occupe, onEnregistrer, onSupprimer }) => {
  const [nom, setNom] = useState(fiche?.data.nom || "");
  const [sujet, setSujet] = useState(fiche?.data.sujet || "");
  const [texte, setTexte] = useState(fiche?.data.texte || "");
  const zone = React.useRef(null);

  /// Insère une variable là où le curseur se trouve dans le corps.
  const insererVariable = (v) => {
    const el = zone.current;
    const jeton = `{{${v}}}`;
    if (!el) return setTexte((t) => t + jeton);
    const debut = el.selectionStart ?? texte.length;
    const fin = el.selectionEnd ?? debut;
    setTexte(texte.slice(0, debut) + jeton + texte.slice(fin));
  };

  const pret = nom.trim() && sujet.trim() && texte.trim();

  return (
    <div className="crrComposeur">
      <div className="crrBarreCommandes">
        <Bouton
          icone="faFloppyDisk"
          off={occupe || !pret}
          onClick={() => onEnregistrer({ nom: nom.trim(), sujet: sujet.trim(), texte })}
        >
          Enregistrer le modèle
        </Bouton>
        {onSupprimer ? (
          <Bouton variante="secondaire" icone="faTrashCan" onClick={onSupprimer}>
            Supprimer
          </Bouton>
        ) : null}
      </div>

      <div className="crrChampLigne">
        <label>Nom</label>
        <input
          value={nom}
          placeholder="Relance de facture, Envoi de devis…"
          onChange={(e) => setNom(e.target.value)}
          autoFocus
        />
      </div>
      <div className="crrChampLigne">
        <label>Objet</label>
        <input
          value={sujet}
          placeholder="Rappel — facture {{numero}}"
          onChange={(e) => setSujet(e.target.value)}
        />
      </div>

      {/* L'aide-mémoire des variables : un clic l'insère au curseur. */}
      <div className="crrVariables">
        {D.VARIABLES_MODELES.map((v) => (
          <span
            key={v.nom}
            className="crrVariable handcr"
            title={v.exemple}
            onClick={() => insererVariable(v.nom)}
          >
            {`{{${v.nom}}}`}
          </span>
        ))}
      </div>

      <textarea
        ref={zone}
        className="crrCorps"
        value={texte}
        placeholder={"Bonjour {{client}},\n\nSauf erreur de notre part, la facture {{numero}} de {{montant}}, échue le {{echeance}}, reste en attente de règlement…"}
        onChange={(e) => setTexte(e.target.value)}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

const Composeur = ({ brouillon, setBrouillon, occupe, modeles = [], onModele, onEnvoyer, onBrouillon, onFermer }) => {
  const maj = (patch) => setBrouillon((b) => ({ ...b, ...patch }));
  const invalides = D.adressesInvalides(brouillon.a);
  const [avecCc, setAvecCc] = useState(Boolean(brouillon.cc));

  // Le carnet d'adresses : les clients du CRM et l'équipe des RH. Chargé
  // une fois — personne ne ressaisit une adresse que l'OS connaît.
  const [contacts, setContacts] = useState([]);
  const [champActif, setChampActif] = useState(null); // "a" | "cc" | null
  useEffect(() => {
    (async () => {
      const [clients, salaries] = await Promise.all([
        api.records.list("crm", "clients").catch(() => []),
        api.records.list("rh", "salaries").catch(() => []),
      ]);
      setContacts(D.contactsDe({ clients, salaries }));
    })();
  }, []);

  const suggestions = champActif
    ? D.suggererContacts(contacts, brouillon[champActif])
    : [];

  const choisirSuggestion = (email) => {
    maj({ [champActif]: D.insererContact(brouillon[champActif], email) });
  };

  const choisirPieces = async () => {
    const noeuds = await modal.open({
      title: "Joindre des fichiers du cloud",
      render: ({ close }) => <ChoixFichier dejaPris={brouillon.pieces} onValider={close} />,
    });
    if (!noeuds?.length) return;
    // Fusion sans doublon, cinq au plus — la même limite que le serveur.
    const pieces = [...brouillon.pieces];
    for (const n of noeuds) {
      if (!pieces.some((p) => p.id === n.id)) pieces.push({ id: n.id, nom: n.name });
    }
    maj({ pieces: pieces.slice(0, 5) });
  };

  return (
    <div className="crrComposeur">
      {/* La barre de commandes d'abord, comme dans les messageries : le
          geste principal — Envoyer — vit en haut à gauche. */}
      <div className="crrBarreCommandes">
        <Bouton icone="faPaperPlane" off={occupe || !D.pretAEnvoyer(brouillon)} onClick={onEnvoyer}>
          Envoyer
        </Bouton>
        <Bouton
          variante="secondaire"
          icone="faPaperclip"
          off={brouillon.pieces.length >= 5}
          onClick={choisirPieces}
        >
          Joindre
        </Bouton>
        <Bouton variante="secondaire" icone="faFloppyDisk" off={occupe} onClick={onBrouillon}>
          Brouillon
        </Bouton>
        {modeles.length ? (
          <Bouton
            variante="secondaire"
            icone="faClone"
            onClick={async () => {
              const m = await modal.open({
                title: "Appliquer un modèle",
                render: ({ close }) => (
                  <div className="crrChoix cosScroll">
                    {modeles.map((x) => (
                      <div key={x.id} className="crrChoixLigne handcr" onClick={() => close(x)}>
                        <div>
                          <div className="crrChoixNom">{x.data.nom}</div>
                          <div className="crrChoixChemin">{x.data.sujet}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ),
              });
              if (m) onModele(m);
            }}
          >
            Modèle
          </Bouton>
        ) : null}
        <span className="crrBarreFin">
          <span className="crrFermer handcr" title="Abandonner" onClick={onFermer}>
            <Icon fafa="faXmark" width={12} />
          </span>
        </span>
      </div>

      <div className="crrChampBloc">
        <div className="crrChampLigne" data-invalide={invalides.length > 0}>
          <label>À</label>
          <input
            value={brouillon.a}
            placeholder="client@entreprise.ci — virgules pour plusieurs destinataires"
            onChange={(e) => maj({ a: e.target.value })}
            onFocus={() => setChampActif("a")}
            onBlur={() => setTimeout(() => setChampActif((c) => (c === "a" ? null : c)), 150)}
            autoFocus
          />
          {!avecCc ? (
            <span className="crrLien handcr" onClick={() => setAvecCc(true)}>
              Cc
            </span>
          ) : null}
        </div>
        {champActif === "a" && suggestions.length ? (
          <Suggestions liste={suggestions} onChoisir={choisirSuggestion} />
        ) : null}
      </div>
      {invalides.length ? (
        <div className="crrChampErreur">Adresse à corriger : {invalides.join(", ")}</div>
      ) : null}

      {avecCc ? (
        <div className="crrChampBloc">
          <div className="crrChampLigne">
            <label>Cc</label>
            <input
              value={brouillon.cc}
              onChange={(e) => maj({ cc: e.target.value })}
              onFocus={() => setChampActif("cc")}
              onBlur={() => setTimeout(() => setChampActif((c) => (c === "cc" ? null : c)), 150)}
            />
          </div>
          {champActif === "cc" && suggestions.length ? (
            <Suggestions liste={suggestions} onChoisir={choisirSuggestion} />
          ) : null}
        </div>
      ) : null}

      <div className="crrChampLigne">
        <label>Objet</label>
        <input
          value={brouillon.sujet}
          placeholder="Facture FAC-2026-0001"
          onChange={(e) => maj({ sujet: e.target.value })}
        />
      </div>

      {brouillon.pieces.length ? (
        <div className="crrPieces">
          {brouillon.pieces.map((p) => (
            <div key={p.id} className="crrPieceChip">
              <Icon fafa="faPaperclip" width={11} />
              <span>{p.nom}</span>
              <span
                className="crrPieceRetirer handcr"
                title="Retirer cette pièce jointe"
                onClick={() => maj({ pieces: brouillon.pieces.filter((x) => x.id !== p.id) })}
              >
                <Icon fafa="faXmark" width={10} />
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <textarea
        className="crrCorps"
        value={brouillon.texte}
        placeholder={"Bonjour,\n\n…"}
        onChange={(e) => maj({ texte: e.target.value })}
      />
    </div>
  );
};

/// La liste déroulante du carnet d'adresses, sous le champ actif.
/// `onMouseDown` et pas `onClick` : le blur du champ part avant le clic,
/// et fermerait la liste juste avant qu'il n'atterrisse.
const Suggestions = ({ liste, onChoisir }) => (
  <div className="crrSuggestions">
    {liste.map((c) => (
      <div
        key={c.email}
        className="crrSuggestion handcr"
        onMouseDown={(e) => {
          e.preventDefault();
          onChoisir(c.email);
        }}
      >
        <span className="crrPastille" style={{ background: D.teinteDe(c.email) }}>
          {D.initialesDe(c.email)}
        </span>
        <div className="crrSuggestionCorps">
          <span className="crrSuggestionNom">{c.nom}</span>
          <span className="crrSuggestionEmail">{c.email}</span>
        </div>
        <span className="crrSuggestionSource">{c.source}</span>
      </div>
    ))}
  </div>
);

/// Choix de pièces jointes : les fichiers du cloud, dossiers parcourus
/// jusqu'à trois niveaux. Un clic coche, le bouton du bas joint le tout —
/// cinq fichiers au plus, ceux déjà joints étant décomptés.
const ChoixFichier = ({ dejaPris = [], onValider }) => {
  const [fichiers, setFichiers] = useState(null);
  const [coches, setCoches] = useState([]); // nœuds sélectionnés
  const placesLibres = 5 - dejaPris.length;

  useEffect(() => {
    (async () => {
      const trouves = [];
      const parcourir = async (parentId, prof, chemin) => {
        const ns = await api.listFiles(parentId).catch(() => []);
        for (const n of ns) {
          if (n.type === "FILE") trouves.push({ ...n, chemin });
          else if (n.type === "FOLDER" && prof < 3) {
            await parcourir(n.id, prof + 1, chemin ? `${chemin} / ${n.name}` : n.name);
          }
        }
      };
      await parcourir(null, 0, "");
      setFichiers(trouves);
    })();
  }, []);

  const basculer = (f) =>
    setCoches((c) => {
      if (c.some((x) => x.id === f.id)) return c.filter((x) => x.id !== f.id);
      return c.length < placesLibres ? [...c, f] : c;
    });

  if (fichiers === null) return <div className="crrChoixVide">Lecture du cloud…</div>;
  if (!fichiers.length) return <div className="crrChoixVide">Aucun fichier dans le cloud.</div>;

  return (
    <div className="crrChoixCadre">
      <div className="crrChoix cosScroll">
        {fichiers.map((f) => {
          const pris = dejaPris.some((p) => p.id === f.id);
          const coche = coches.some((x) => x.id === f.id);
          return (
            <div
              key={f.id}
              className="crrChoixLigne handcr"
              data-coche={coche}
              data-pris={pris}
              onClick={() => !pris && basculer(f)}
            >
              <span className="crrChoixCase">
                {coche || pris ? <Icon fafa="faCheck" width={10} /> : null}
              </span>
              <img src={`img/icon/cos/${iconeDeFichier(f)}.svg`} alt="" width={22} />
              <div>
                <div className="crrChoixNom">{f.name}</div>
                <div className="crrChoixChemin">
                  {pris ? "Déjà jointe" : f.chemin || "Racine du cloud"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="crrChoixPied">
        <span>
          {coches.length
            ? `${coches.length} fichier${coches.length > 1 ? "s" : ""} sélectionné${coches.length > 1 ? "s" : ""}`
            : `Jusqu'à ${placesLibres} fichier${placesLibres > 1 ? "s" : ""}`}
        </span>
        <Bouton icone="faPaperclip" off={!coches.length} onClick={() => onValider(coches)}>
          Joindre
        </Bouton>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Réglages SMTP de l'espace
// ---------------------------------------------------------------------------

const Reglages = ({ modeles = [] }) => {
  const [reglages, setReglages] = useState(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    api.courrierReglages().then(setReglages).catch(() => setReglages({}));
  }, []);

  const maj = (patch) => setReglages((r) => ({ ...r, ...patch }));
  const majRelances = (patch) =>
    setReglages((r) => ({ ...r, relances: { ...r.relances, ...patch } }));

  const enregistrer = async () => {
    setOccupe(true);
    try {
      await api.courrierEnregistrerReglages({
        host: reglages.host || "",
        port: Number(reglages.port) || 587,
        user: reglages.user || "",
        pass: reglages.pass || "",
        de: reglages.de || "",
        relances: {
          actif: Boolean(reglages.relances?.actif),
          paliers: String(reglages.relances?.paliersTexte ?? (reglages.relances?.paliers || []).join(", "))
            .split(/[,;]/)
            .map((n) => parseInt(n, 10))
            .filter((n) => n > 0),
          modeleId: reglages.relances?.modeleId || "",
        },
      });
      setReglages(await api.courrierReglages());
      modal.alert({
        title: "Réglages enregistrés",
        message: "Le relais SMTP de l'espace est à jour.",
        tone: "success",
      });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  if (!reglages) return <div className="crrChoixVide">Lecture des réglages…</div>;

  return (
    <div className="crrReglages">
      <h2 className="crrLectureSujet">Relais SMTP de l'entreprise</h2>
      <Notice>
        Les courriels partent de votre domaine, à votre nom. N'importe quel
        fournisseur convient — Brevo, Resend, un Gmail professionnel.
        {reglages.relaisPlateforme
          ? " Sans réglage, le relais de la plateforme prend le relais."
          : " Sans réglage, aucun envoi ne peut partir."}
      </Notice>

      <div className="crrGrille">
        <Champ label="Serveur SMTP">
          <input
            value={reglages.host || ""}
            placeholder="smtp-relay.brevo.com"
            onChange={(e) => maj({ host: e.target.value })}
          />
        </Champ>
        <Champ label="Port" aide="587 (STARTTLS) ou 465 (TLS)">
          <input
            type="number"
            value={reglages.port || 587}
            onChange={(e) => maj({ port: e.target.value })}
          />
        </Champ>
        <Champ label="Identifiant">
          <input
            value={reglages.user || ""}
            onChange={(e) => maj({ user: e.target.value })}
          />
        </Champ>
        <Champ
          label="Mot de passe / clé SMTP"
          aide={reglages.motDePasseDefini ? "Défini — laissez vide pour le conserver" : "À renseigner"}
        >
          <input
            type="password"
            value={reglages.pass || ""}
            placeholder={reglages.motDePasseDefini ? "••••••••" : ""}
            onChange={(e) => maj({ pass: e.target.value })}
          />
        </Champ>
        <Champ label="Expéditeur" aide="Ce que verront vos destinataires">
          <input
            value={reglages.de || ""}
            placeholder="SunLab <contact@sunlab.ci>"
            onChange={(e) => maj({ de: e.target.value })}
          />
        </Champ>
      </div>

      <h2 className="crrLectureSujet">Relances de factures</h2>
      <Notice>
        Quand une facture échue reste impayée, le rappel part tout seul aux
        paliers choisis — une seule fois par palier, jamais deux d'un coup,
        et tout s'archive dans les Envoyés. La Facturation fournit les
        montants ; personne n'écrit à un client qui a déjà payé.
      </Notice>

      <div className="crrRelanceLigne">
        <label className="crrBascule handcr">
          <input
            type="checkbox"
            checked={Boolean(reglages.relances?.actif)}
            onChange={(e) => majRelances({ actif: e.target.checked })}
          />
          <span>Relancer automatiquement les factures impayées</span>
        </label>
      </div>

      {reglages.relances?.actif ? (
        <div className="crrGrille">
          <Champ label="Paliers (jours après l'échéance)" aide="Séparés par des virgules">
            <input
              value={
                reglages.relances?.paliersTexte ??
                (reglages.relances?.paliers || [7, 15, 30]).join(", ")
              }
              onChange={(e) => majRelances({ paliersTexte: e.target.value })}
            />
          </Champ>
          <Champ label="Modèle du message" aide="Variables {{client}}, {{numero}}, {{montant}}, {{echeance}}">
            <select
              value={reglages.relances?.modeleId || ""}
              onChange={(e) => majRelances({ modeleId: e.target.value })}
            >
              <option value="">Message par défaut</option>
              {modeles.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.data.nom}
                </option>
              ))}
            </select>
          </Champ>
        </div>
      ) : null}

      <div className="crrBarreCommandes">
        <Bouton icone="faFloppyDisk" off={occupe} onClick={enregistrer}>
          Enregistrer les réglages
        </Bouton>
      </div>
    </div>
  );
};
