// Comptabilité — saisie par pièce, et opérations guidées.
//
// Deux portes vers la même écriture. La **pièce comptable** est la grille
// des logiciels professionnels : un journal, une date, des lignes au
// compte, et tout au clavier — Entrée pour choisir un compte, « = » pour
// solder, Ctrl+Entrée pour enregistrer. L'**opération guidée** est la
// phrase « J'ai payé le loyer » pour qui ne connaît pas le plan.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { saveToCloud } from "../../cloud";
import { choisirFichierCloud, blobDuFichier } from "../../ChoisirFichier";
import * as D from "./domaine";
import {
  JOURNAUX,
  avecTva,
  chercherComptes,
  controlesPiece,
  ecritureDePiece,
  estTiers,
  journalDe,
  lignesUtiles,
  prochainNumero,
  soldeSur,
} from "./journaux";
import { Bouton, Carte, Entete, LignesEcriture, Puce, aujourdhui, nb, ouvrirJustificatif, useCpt } from "./commun";

let compteur = 0;
const nouvelleLigne = (base = {}) => ({ id: `l${(compteur += 1)}`, compte: "", tiers: "", libelle: "", debit: "", credit: "", ...base });

const MODELES_PIECE = [
  { id: "", label: "Aucun modèle" },
  {
    id: "vente",
    label: "Facture de vente · TVA 18 %",
    journal: "VTE",
    taux: 18,
    lignes: [{ compte: "411" }, { compte: "706" }],
  },
  {
    id: "achat",
    label: "Facture d'achat · TVA 18 %",
    journal: "ACH",
    taux: 18,
    lignes: [{ compte: "601" }, { compte: "401" }],
  },
  { id: "encaissement", label: "Encaissement client (banque)", journal: "BQ", lignes: [{ compte: "521" }, { compte: "411" }] },
  { id: "decaissement", label: "Paiement fournisseur (banque)", journal: "BQ", lignes: [{ compte: "401" }, { compte: "521" }] },
  { id: "frais", label: "Frais bancaires", journal: "BQ", lignes: [{ compte: "631" }, { compte: "521" }] },
  { id: "versement", label: "Versement d'espèces en banque", journal: "OD", lignes: [{ compte: "521" }, { compte: "571" }] },
  { id: "attente", label: "Imputer le compte d'attente 471", journal: "OD", lignes: [{ compte: "" }, { compte: "471" }] },
];

const pieceVide = (journal = "VTE") => ({
  journal,
  date: aujourdhui(),
  reference: "",
  echeance: "",
  libelle: "",
  taux: journal === "VTE" || journal === "ACH" ? 18 : 0,
  modele: "",
  justificatif: null,
  lignes: [nouvelleLigne(), nouvelleLigne()],
});

export const Saisie = () => {
  const { intention } = useCpt();
  const [mode, setMode] = useState(intention?.mode === "guide" ? "guide" : "piece");
  return (
    <div className="cptVue">
      {mode === "piece" ? <SaisiePiece onGuide={() => setMode("guide")} /> : <SaisieGuidee onPiece={() => setMode("piece")} />}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Pièce comptable
// ---------------------------------------------------------------------------

/// Les noms proposés pour le tiers : clients du CRM, fournisseurs du Stock,
/// et tous ceux déjà vus au journal.
const useNomsTiers = () => {
  const { clientsCrm, fournisseurs, ecritures } = useCpt();
  return useMemo(() => {
    const s = new Set();
    for (const c of clientsCrm) s.add(c.data.entreprise || c.data.nom);
    for (const f of fournisseurs) s.add(f.data.nom);
    for (const e of ecritures) if (e.data.tiers) s.add(e.data.tiers);
    return [...s].filter(Boolean).sort((a, b) => a.localeCompare(b, "fr"));
  }, [clientsCrm, fournisseurs, ecritures]);
};

const SaisiePiece = ({ onGuide }) => {
  const { ecritures, clotureAu, creer, occupe, intention, axe } = useCpt();
  const [piece, setPiece] = useState(() => {
    if (intention?.compte === "471") {
      // Le solde du compte d'attente est prérempli : il ne reste qu'à
      // choisir le compte où il aurait dû aller.
      const solde = Math.round(D.balance(ecritures).find((c) => c.compte === "471")?.solde || 0);
      const m = String(Math.abs(solde));
      return {
        ...pieceVide("OD"),
        libelle: "Imputation du compte d'attente",
        lignes: [
          nouvelleLigne(solde > 0 ? { debit: m } : { credit: m }),
          nouvelleLigne({ compte: "471", ...(solde > 0 ? { credit: m } : { debit: m }) }),
          nouvelleLigne(),
        ],
      };
    }
    return pieceVide(intention?.journal || "VTE");
  });
  const grille = useRef(null);
  const [actif, setActif] = useState(null); // { rang, champ }

  const lignes = useMemo(() => avecTva(piece.lignes, piece.taux), [piece.lignes, piece.taux]);
  const numero = useMemo(() => prochainNumero(ecritures, piece.journal, piece.date), [ecritures, piece.journal, piece.date]);
  const controles = useMemo(
    () => controlesPiece({ ...piece, lignes }, { clotureAu, numero, taux: piece.taux }),
    [piece, lignes, clotureAu, numero],
  );
  const bloque = controles.some((c) => c.bloquant && !c.ok);
  const totaux = D.totauxEcriture({ lignes: lignesUtiles(lignes) });
  const equilibree = lignesUtiles(lignes).length >= 2 && Math.abs(totaux.ecart) < 1;

  const nomsTiers = useNomsTiers();

  // ---- Édition --------------------------------------------------------------

  const maj = (patch) => setPiece((p) => ({ ...p, ...patch }));
  const majLigne = (id, patch) =>
    setPiece((p) => {
      let suite = p.lignes.map((l) => (l.id === id ? { ...l, ...patch } : l));
      // Une ligne qui se remplit en appelle une nouvelle : on ne cherche
      // jamais le bouton « ajouter une ligne » au milieu d'une saisie.
      const derniere = suite[suite.length - 1];
      if (derniere.compte && (derniere.debit || derniere.credit)) suite = [...suite, nouvelleLigne()];
      return { ...p, lignes: suite };
    });
  const retirer = (id) =>
    setPiece((p) => {
      const suite = p.lignes.filter((l) => l.id !== id);
      return { ...p, lignes: suite.length ? suite : [nouvelleLigne()] };
    });

  const appliquerModele = (id) => {
    const m = MODELES_PIECE.find((x) => x.id === id);
    if (!m?.id) return maj({ modele: "" });
    setPiece((p) => ({
      ...p,
      modele: id,
      journal: m.journal,
      taux: m.taux || 0,
      libelle: p.libelle || m.label.split(" · ")[0],
      lignes: [...m.lignes.map((l) => nouvelleLigne(l)), nouvelleLigne()],
    }));
  };

  const solder = (rang) => {
    // Les lignes de TVA calculées suivent les lignes saisies : le rang d'une
    // ligne saisie est le même dans les deux listes.
    const { debit, credit } = soldeSur(lignes, rang);
    const l = piece.lignes[rang];
    if (l) majLigne(l.id, { debit: debit ? String(debit) : "", credit: credit ? String(credit) : "" });
  };

  const dupliquerPrecedente = () => {
    const precedente = [...ecritures]
      .filter((e) => journalDe(e) === piece.journal && !e.data.contrepasse)
      .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)))[0];
    if (!precedente) {
      modal.alert({ title: "Rien à dupliquer", message: `Aucune pièce dans le journal ${piece.journal}.` });
      return;
    }
    setPiece((p) => ({
      ...p,
      libelle: precedente.data.libelle,
      lignes: [
        ...precedente.data.lignes
          .filter((l) => !l.auto)
          .map((l) => nouvelleLigne({
            compte: l.compte,
            tiers: l.tiers || (estTiers(l.compte) ? precedente.data.tiers : "") || "",
            libelle: l.libelle || "",
            debit: l.debit ? String(l.debit) : "",
            credit: l.credit ? String(l.credit) : "",
          })),
        nouvelleLigne(),
      ],
    }));
  };

  const enregistrer = useCallback(
    async (nouvelle) => {
      if (bloque || occupe) return;
      const tiers = lignes.find((l) => estTiers(l.compte) && l.tiers)?.tiers || "";
      const e = ecritureDePiece({ ...piece, lignes, tiers, axe: axe || "" }, numero);
      const rec = await creer(e);
      if (!rec) return;
      if (nouvelle) {
        setPiece((p) => ({ ...pieceVide(p.journal), date: p.date, taux: p.taux }));
      } else {
        await modal.alert({ title: `Pièce ${numero} enregistrée`, message: e.libelle, tone: "success" });
        setPiece((p) => ({ ...pieceVide(p.journal), date: p.date, taux: p.taux }));
      }
    },
    [bloque, occupe, lignes, piece, numero, creer, axe],
  );

  // ---- Clavier ------------------------------------------------------------

  useEffect(() => {
    const touche = (ev) => {
      if (!grille.current?.closest(".cptVue")?.contains(document.activeElement) && document.activeElement !== document.body) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
        ev.preventDefault();
        enregistrer(ev.shiftKey);
      } else if ((ev.ctrlKey || ev.metaKey) && (ev.key === "d" || ev.key === "D")) {
        ev.preventDefault();
        dupliquerPrecedente();
      } else if (ev.key === "F4") {
        ev.preventDefault();
        const rang = actif?.rang ?? piece.lignes.findIndex((l) => !l.compte);
        const champ = grille.current?.querySelector(`[data-rang="${Math.max(0, rang)}"] .cptCompteSaisie`);
        champ?.focus();
        champ?.dispatchEvent(new CustomEvent("cpt-ouvrir"));
      }
    };
    document.addEventListener("keydown", touche);
    return () => document.removeEventListener("keydown", touche);
  });

  // ---- Justificatif -------------------------------------------------------

  const joindreCloud = async () => {
    const node = await choisirFichierCloud({
      titre: "Joindre un justificatif",
      filtre: (n) => /\.(pdf|png|jpe?g|webp|gif)$/i.test(n.name),
    });
    if (node) maj({ justificatif: { id: node.id, name: node.name, mimeType: node.mimeType || "" } });
  };
  const fichier = useRef(null);
  const importer = async (f) => {
    if (!f) return;
    const node = await saveToCloud(f, f.name, { folder: "Comptabilité" });
    if (node) maj({ justificatif: { id: node.id, name: node.name, mimeType: node.mimeType || f.type } });
  };

  const venteOuAchat = piece.journal === "VTE" || piece.journal === "ACH";

  return (
    <>
      <Entete titre="Nouvelle pièce" sous={`${numero} · ${JOURNAUX.find((j) => j.code === piece.journal)?.label || ""}`}>
        <label className="cptChampTete">
          <span>Modèle</span>
          <select value={piece.modele} onChange={(e) => appliquerModele(e.target.value)}>
            {MODELES_PIECE.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
        <Bouton icone="faWandMagicSparkles" onClick={onGuide} title="Sans numéro de compte : choisissez une phrase">
          Opération guidée
        </Bouton>
        <Bouton disabled={bloque || occupe} onClick={() => enregistrer(true)}>
          Enregistrer et nouvelle
        </Bouton>
        <Bouton variante="principal" icone="faCheck" disabled={bloque || occupe} onClick={() => enregistrer(false)}>
          Enregistrer la pièce
        </Bouton>
      </Entete>

      <div className="cptConteneur cptSaisie">
        <div className="cptSaisieCentre">
          <Carte>
            <div className="cptChampsPiece">
              <label>
                <span>Journal</span>
                <select
                  value={piece.journal}
                  onChange={(e) => maj({ journal: e.target.value, taux: ["VTE", "ACH"].includes(e.target.value) ? piece.taux || 18 : piece.taux })}
                >
                  {JOURNAUX.map((j) => (
                    <option key={j.code} value={j.code}>{j.code} — {j.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Date</span>
                <input type="date" value={piece.date} onChange={(e) => maj({ date: e.target.value })} />
              </label>
              <label>
                <span>N° de pièce</span>
                <input value={numero} readOnly aria-readonly="true" className="cptLectureSeule" />
              </label>
              <label>
                <span>Référence</span>
                <input value={piece.reference} placeholder="FAC-2026-0210" onChange={(e) => maj({ reference: e.target.value })} />
              </label>
              {venteOuAchat ? (
                <label>
                  <span>Échéance</span>
                  <input type="date" value={piece.echeance} onChange={(e) => maj({ echeance: e.target.value })} />
                </label>
              ) : null}
              <label>
                <span>TVA automatique</span>
                <select value={piece.taux} onChange={(e) => maj({ taux: Number(e.target.value) })}>
                  <option value={0}>Non</option>
                  {D.TAUX_TVA.filter(Boolean).map((t) => (
                    <option key={t} value={t}>{t} %</option>
                  ))}
                </select>
              </label>
              <label className="cptChampLarge">
                <span>Libellé de la pièce</span>
                <input value={piece.libelle} placeholder="Facture Cansaas Agency — développement web" onChange={(e) => maj({ libelle: e.target.value })} />
              </label>
            </div>
          </Carte>

          <Carte className="cptGrilleCarte">
            <div className="cptGrilleSaisie" ref={grille} role="table" aria-label="Lignes de la pièce">
              <div className="cptGL cptGLTete" role="row">
                <span>Compte</span>
                <span>Tiers</span>
                <span>Libellé</span>
                <span className="cptMt">Débit</span>
                <span className="cptMt">Crédit</span>
                <span />
              </div>
              {lignes.map((l, rang) =>
                l.auto ? (
                  <div key={`auto-${l.compte}`} className="cptGL cptGLAuto" role="row">
                    <span className="cptCompteFixe">
                      <b>{l.compte}</b> {D.intitule(l.compte)}
                    </span>
                    <span>—</span>
                    <span>
                      {l.libelle} <em className="cptAuto">calculée</em>
                    </span>
                    <span className="cptMt">{l.debit ? nb(l.debit) : ""}</span>
                    <span className="cptMt">{l.credit ? nb(l.credit) : ""}</span>
                    <span />
                  </div>
                ) : (
                  <div key={l.id} className="cptGL" role="row" data-rang={rang}>
                    <ChoixCompte
                      valeur={l.compte}
                      onFocus={() => setActif({ rang, champ: "compte" })}
                      onChoisir={(code) => majLigne(l.id, { compte: code })}
                    />
                    <input
                      list="cpt-tiers"
                      value={l.tiers}
                      placeholder={estTiers(l.compte) ? "Client ou fournisseur" : "—"}
                      aria-label="Tiers"
                      data-requis={estTiers(l.compte) && !l.tiers ? "true" : "false"}
                      onChange={(e) => majLigne(l.id, { tiers: e.target.value })}
                    />
                    <input
                      value={l.libelle}
                      placeholder={piece.libelle || "Libellé"}
                      aria-label="Libellé de la ligne"
                      onChange={(e) => majLigne(l.id, { libelle: e.target.value })}
                    />
                    <Montant
                      valeur={l.debit}
                      label="Débit"
                      onSolder={() => solder(rang)}
                      onChanger={(v) => majLigne(l.id, { debit: v, credit: v ? "" : l.credit })}
                    />
                    <Montant
                      valeur={l.credit}
                      label="Crédit"
                      onSolder={() => solder(rang)}
                      onChanger={(v) => majLigne(l.id, { credit: v, debit: v ? "" : l.debit })}
                    />
                    <button type="button" className="cptRetirer" aria-label="Retirer la ligne" onClick={() => retirer(l.id)}>
                      ×
                    </button>
                  </div>
                ),
              )}
              <datalist id="cpt-tiers">
                {nomsTiers.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button type="button" className="cptAjoutLigne" onClick={() => setPiece((p) => ({ ...p, lignes: [...p.lignes, nouvelleLigne()] }))}>
                + Nouvelle ligne
              </button>
            </div>

            <div className="cptPiedPiece" data-equilibree={equilibree ? "true" : "false"}>
              <span className="cptEquilibre">
                <Icon fafa={equilibree ? "faCircleCheck" : "faCircleExclamation"} width={14} />
                {equilibree ? "Pièce équilibrée" : "Pièce non équilibrée"}
              </span>
              <span>Total débit <b>{nb(totaux.debit)}</b></span>
              <span>Total crédit <b>{nb(totaux.credit)}</b></span>
              <span data-ecart={Math.abs(totaux.ecart) >= 1 ? "true" : "false"}>Écart <b>{nb(Math.abs(totaux.ecart))}</b></span>
            </div>
          </Carte>

          <div className="cptRaccourcis" aria-label="Raccourcis clavier">
            <span><kbd>Ctrl</kbd> + <kbd>Entrée</kbd> enregistrer</span>
            <span><kbd>=</kbd> solde la ligne</span>
            <span><kbd>F4</kbd> rechercher un compte</span>
            <span><kbd>Ctrl</kbd> + <kbd>D</kbd> dupliquer la pièce précédente</span>
          </div>
        </div>

        <aside className="cptSaisieCote">
          <Carte
            titre="Justificatif"
            actions={
              piece.justificatif ? (
                <button type="button" className="cptLien" onClick={() => maj({ justificatif: null })}>
                  Retirer
                </button>
              ) : null
            }
          >
            {piece.justificatif ? (
              <Apercu justificatif={piece.justificatif} />
            ) : (
              <div className="cptDepot">
                <Icon fafa="faPaperclip" width={18} />
                <p>Joignez la facture ou le reçu : un contrôle fiscal demande la pièce derrière chaque écriture.</p>
                <div>
                  <Bouton icone="faCloud" onClick={joindreCloud}>Depuis le Cloud</Bouton>
                  <Bouton icone="faUpload" onClick={() => fichier.current?.click()}>Importer</Bouton>
                </div>
                <input
                  ref={fichier}
                  type="file"
                  hidden
                  accept="application/pdf,image/*"
                  onChange={(e) => {
                    importer(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            )}
          </Carte>

          <Carte titre="Contrôles de la pièce">
            <ul className="cptControles">
              {controles.map((c) => (
                <li key={c.id}>
                  <Puce ok={c.ok} bloquant={c.bloquant} />
                  <span>
                    <b>{c.titre}</b>
                    <small>{c.detail}</small>
                  </span>
                </li>
              ))}
            </ul>
          </Carte>
        </aside>
      </div>
    </>
  );
};

/// Montant de la grille : « = » solde la ligne, comme dans les logiciels
/// comptables.
const Montant = ({ valeur, label, onChanger, onSolder }) => (
  <input
    className="cptMtSaisie"
    inputMode="decimal"
    value={valeur}
    aria-label={label}
    placeholder=""
    onKeyDown={(e) => {
      if (e.key === "=") {
        e.preventDefault();
        onSolder();
      }
    }}
    onChange={(e) => onChanger(e.target.value.replace(/[^\d\s,.-]/g, ""))}
  />
);

/// Saisie d'un compte avec la liste du plan : flèches pour choisir, Entrée
/// pour valider, Échap pour fermer.
const ChoixCompte = ({ valeur, onChoisir, onFocus }) => {
  const [texte, setTexte] = useState(valeur);
  const [ouvert, setOuvert] = useState(false);
  const [i, setI] = useState(0);
  const ref = useRef(null);
  useEffect(() => setTexte(valeur), [valeur]);
  useEffect(() => {
    const el = ref.current;
    const ouvrir = () => setOuvert(true);
    el?.addEventListener("cpt-ouvrir", ouvrir);
    return () => el?.removeEventListener("cpt-ouvrir", ouvrir);
  }, []);
  const liste = useMemo(() => chercherComptes(texte === valeur && ouvert && !texte ? "" : texte), [texte, valeur, ouvert]);
  const choisir = (c) => {
    setTexte(c.code);
    setOuvert(false);
    onChoisir(c.code);
  };
  return (
    <div className="cptCompte">
      <input
        ref={ref}
        className="cptCompteSaisie"
        value={texte}
        placeholder="Compte"
        aria-label="Compte"
        aria-autocomplete="list"
        aria-expanded={ouvert}
        onFocus={() => onFocus?.()}
        onChange={(e) => {
          setTexte(e.target.value);
          setOuvert(true);
          setI(0);
        }}
        onBlur={() =>
          setTimeout(() => {
            setOuvert(false);
            if (texte !== valeur) {
              if (/^[1-8]\d{1,7}$/.test(texte.trim())) onChoisir(texte.trim());
              else setTexte(valeur);
            }
          }, 120)
        }
        onKeyDown={(e) => {
          if (!ouvert && (e.key === "ArrowDown" || e.key === "F4")) {
            setOuvert(true);
            return;
          }
          if (!ouvert) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setI((x) => Math.min(liste.length - 1, x + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setI((x) => Math.max(0, x - 1));
          } else if (e.key === "Enter" && liste[i]) {
            e.preventDefault();
            choisir(liste[i]);
          } else if (e.key === "Escape") {
            e.stopPropagation();
            setOuvert(false);
          }
        }}
      />
      {valeur && !ouvert ? <small className="cptCompteNom">{D.intitule(valeur)}</small> : null}
      {ouvert && liste.length ? (
        <div className="cptSuggestionsCompte" role="listbox">
          {liste.map((c, k) => (
            <button
              type="button"
              key={c.code}
              role="option"
              aria-selected={k === i}
              onMouseDown={(e) => {
                e.preventDefault();
                choisir(c);
              }}
            >
              <b>{c.code}</b>
              <span>{c.horsPlan ? "Compte hors de l'extrait du plan" : c.label}</span>
            </button>
          ))}
          <small>Plan SYSCOHADA révisé · ↑ ↓ pour choisir, Entrée pour valider</small>
        </div>
      ) : null}
    </div>
  );
};

/// L'aperçu d'un justificatif : l'image elle-même, ou une fiche pour un PDF
/// (que la visionneuse ouvre).
const Apercu = ({ justificatif }) => {
  const [url, setUrl] = useState("");
  const image = /\.(png|jpe?g|webp|gif)$/i.test(justificatif.name) || /^image\//.test(justificatif.mimeType || "");
  useEffect(() => {
    if (!image) return undefined;
    let lien = "";
    let vivant = true;
    blobDuFichier({ id: justificatif.id, name: justificatif.name })
      .then((b) => {
        if (!vivant) return;
        lien = URL.createObjectURL(b);
        setUrl(lien);
      })
      .catch(() => {});
    return () => {
      vivant = false;
      if (lien) URL.revokeObjectURL(lien);
    };
  }, [justificatif.id, image, justificatif.name]);
  return (
    <div className="cptApercuJustif">
      {image && url ? (
        <img src={url} alt={`Justificatif ${justificatif.name}`} />
      ) : (
        <div className="cptFicheFichier">
          <Icon fafa={image ? "faImage" : "faFilePdf"} width={26} />
        </div>
      )}
      <button type="button" className="cptLien" onClick={() => ouvrirJustificatif(justificatif)}>
        {justificatif.name} · joint depuis le Cloud
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Opération guidée
// ---------------------------------------------------------------------------

const JOURNAL_TRESORERIE = { 571: "CAI", 521: "BQ", 531: "MM" };

const SaisieGuidee = ({ onPiece }) => {
  const { creer, occupe, axe } = useCpt();
  const [brouillon, setBrouillon] = useState(null);
  const nomsTiers = useNomsTiers();

  const familles = useMemo(() => {
    const m = new Map();
    for (const mod of D.MODELES) {
      if (!m.has(mod.famille)) m.set(mod.famille, []);
      m.get(mod.famille).push(mod);
    }
    return [...m.entries()];
  }, []);

  const modele = brouillon?.modele ? D.MODELES.find((m) => m.id === brouillon.modele) : null;

  const apercu = useMemo(() => {
    if (!modele || !brouillon?.montant) return null;
    const e = D.ecritureDepuisModele({
      modele,
      montant: brouillon.montant,
      date: brouillon.date,
      libelle: brouillon.libelle,
      taux: brouillon.taux,
      compteTresorerie: brouillon.compteTresorerie,
      tiers: brouillon.tiers,
      axe,
    });
    const tresorerie = e.lignes.find((l) => JOURNAL_TRESORERIE[l.compte]);
    return {
      ...e,
      journal: tresorerie ? JOURNAL_TRESORERIE[tresorerie.compte] : modele.famille === "Achats" ? "ACH" : "OD",
      lignes: e.lignes.map((l) => (estTiers(l.compte) && brouillon.tiers ? { ...l, tiers: brouillon.tiers } : l)),
    };
  }, [modele, brouillon, axe]);

  const besoinTiers = apercu?.lignes.some((l) => estTiers(l.compte));

  return (
    <>
      <Entete titre="Opération guidée" sous="Sans numéro de compte : choisissez ce que vous avez fait">
        <Bouton icone="faTableList" onClick={onPiece}>Saisie par pièce</Bouton>
      </Entete>
      <div className="cptConteneur">
        <Carte aide="Les comptes sont trouvés pour vous — vous verrez l'écriture avant de l'enregistrer.">
          <div className="cptModeles">
            {familles.map(([famille, liste]) => (
              <div key={famille} className="cptFamille">
                <div className="cptFamilleNom">{famille}</div>
                <div className="cptFamilleListe">
                  {liste.map((m) => (
                    <button
                      type="button"
                      key={m.id}
                      className="cptModele"
                      aria-pressed={brouillon?.modele === m.id}
                      onClick={() =>
                        setBrouillon({
                          modele: m.id,
                          date: aujourdhui(),
                          montant: "",
                          libelle: "",
                          taux: 18,
                          compteTresorerie: m.tresorerie ? "571" : undefined,
                          tiers: "",
                        })
                      }
                    >
                      {m.phrase}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Carte>

        {modele ? (
          <Carte titre={modele.phrase} aide={modele.aide}>
            <div className="cptChampsPiece">
              <label>
                <span>Montant reçu ou payé (TTC)</span>
                <input
                  inputMode="decimal"
                  autoFocus
                  value={brouillon.montant}
                  onChange={(e) => setBrouillon((b) => ({ ...b, montant: e.target.value.replace(/[^\d.,]/g, "").replace(",", ".") }))}
                  placeholder="0"
                />
              </label>
              <label>
                <span>Date</span>
                <input type="date" value={brouillon.date} onChange={(e) => setBrouillon((b) => ({ ...b, date: e.target.value }))} />
              </label>
              {modele.tva ? (
                <label>
                  <span>TVA</span>
                  <select value={brouillon.taux} onChange={(e) => setBrouillon((b) => ({ ...b, taux: Number(e.target.value) }))}>
                    {D.TAUX_TVA.map((t) => (
                      <option key={t} value={t}>{t ? `${t} %` : "Exonéré"}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              {modele.tresorerie ? (
                <label>
                  <span>{modele.tresorerie === "debit" ? "Reçu sur" : "Payé par"}</span>
                  <select value={brouillon.compteTresorerie} onChange={(e) => setBrouillon((b) => ({ ...b, compteTresorerie: e.target.value }))}>
                    {D.TRESORERIE.map((t) => (
                      <option key={t.code} value={t.code}>{t.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label>
                <span>Client ou fournisseur{besoinTiers ? " *" : ""}</span>
                <input list="cpt-tiers-guide" value={brouillon.tiers} onChange={(e) => setBrouillon((b) => ({ ...b, tiers: e.target.value }))} />
                <datalist id="cpt-tiers-guide">
                  {nomsTiers.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label className="cptChampLarge">
                <span>Précision</span>
                <input value={brouillon.libelle} placeholder={modele.phrase} onChange={(e) => setBrouillon((b) => ({ ...b, libelle: e.target.value }))} />
              </label>
            </div>
            {apercu ? (
              <div className="cptApercu">
                <div className="cptApercuTitre">Voici l'écriture qui sera enregistrée, journal {apercu.journal}</div>
                <LignesEcriture lignes={apercu.lignes} />
              </div>
            ) : null}
            <div className="cptActions">
              <Bouton
                variante="principal"
                icone="faCheck"
                disabled={occupe || !apercu || (besoinTiers && !brouillon.tiers.trim())}
                onClick={async () => {
                  const rec = await creer(apercu);
                  if (rec) setBrouillon(null);
                }}
              >
                Enregistrer au journal
              </Bouton>
              <Bouton onClick={() => setBrouillon(null)}>Annuler</Bouton>
            </div>
          </Carte>
        ) : null}
      </div>
    </>
  );
};
