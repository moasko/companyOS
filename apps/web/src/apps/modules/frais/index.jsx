// Notes de frais.
//
// ─────────────────────────────────────────────────────────────────────────
// LE CIRCUIT DU REMBOURSEMENT
//
// Le salarié — rattaché par l'email de sa session, comme aux Congés —
// photographie son reçu, soumet la dépense, suit son remboursement. Le
// responsable valide avec le justificatif sous les yeux, puis marque
// remboursée quand l'argent est parti. Chacun est notifié à chaque pas.
//
// Le reçu vit dans le cloud (dossier « Notes de frais ») : visible dans
// l'Explorateur, ouvert d'un clic depuis la note. Et chaque note
// approuvée propose son écriture à la Comptabilité — charge de la
// catégorie contre compte du personnel — qu'on passe là-bas d'un clic.
//
// L'app suit le réglage « Langue et région » : textes dans TEXTES (fr/en,
// repli par clé), montants via useDevise — voir la partie 8 du guide.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier, envoyerA } from "../../notifications";
import { saveToCloud } from "../../cloud";
import { ouvrirFichier } from "../../openRequest";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Vide } from "../../ui";
import { useDevise, useTraduction } from "../../../utils/intl";
import { salarieDe } from "../conges/domaine";
import * as D from "./domaine";
import "./frais.scss";

export const manifest = {
  id: "frais",
  slug: "frais",
  name: "Notes de frais",
  icon: "frais",
  action: "FRAISAPP",
  Window: FraisApp,
};

const TEXTES = {
  fr: {
    verrou: "Connectez-vous pour vos notes de frais.",
    vueMoi: "Mes notes",
    vueValidation: "À valider",
    vueRemboursement: "À rembourser",
    salarie: "Salarié",
    sansFicheTitre: "Aucune fiche salarié à votre nom",
    sansFicheAide:
      "Votre compte ({email}) n'est relié à aucune fiche RH. Demandez à un responsable d'y renseigner votre adresse email.",
    noteIncomplete: "Note incomplète",
    noteSoumise: "Note soumise",
    noteSoumiseMsg: "{montant} — en attente de validation.",
    notifResponsable: "Note de frais — {nom}",
    categorieMontant: "{categorie} : {montant}.",
    soumissionImpossible: "Soumission impossible",
    recuImpossible: "Envoi du reçu impossible",
    retirerTitre: "Retirer cette note ?",
    retirer: "Retirer",
    actionImpossible: "Action impossible",
    refuserTitre: "Refuser cette note ?",
    refuserMsg: "{nom} — {montant}.",
    refuser: "Refuser",
    approuver: "Approuver",
    noteApprouvee: "Note de frais approuvée",
    noteRefusee: "Note de frais refusée",
    noteRemboursee: "Note de frais remboursée",
    marquerRemboursee: "Marquer remboursée",
    aucuneAValider: "Aucune note à valider.",
    rienARembourser: "Rien à rembourser — tout est soldé.",
    rembourserAide:
      "Une note approuvée attend son remboursement : espèces, mobile money ou virement, puis marquez-la ici. L'écriture comptable est proposée dans la Comptabilité.",
    enValidation: "en validation",
    aRembourser: "à rembourser",
    remboursees: "remboursées",
    soumettreTitre: "Soumettre une dépense",
    champDate: "Date",
    champCategorie: "Catégorie",
    champMontant: "Montant (F CFA)",
    champDescription: "Description",
    descriptionExemple: "Taxi rendez-vous client, Yopougon",
    joindreRecu: "Joindre le reçu (photo ou PDF)",
    soumettre: "Soumettre",
    mesNotes: "Mes notes",
    aucuneNote: "Aucune note pour l'instant.",
    voirRecu: "· voir le reçu",
    "categorie.transport": "Transport & taxi",
    "categorie.carburant": "Carburant",
    "categorie.repas": "Repas & réception",
    "categorie.hebergement": "Hébergement",
    "categorie.fournitures": "Fournitures & petit matériel",
    "categorie.communication": "Téléphone & internet",
    "categorie.autre": "Autre dépense",
    "etat.soumise": "À valider",
    "etat.approuvee": "Approuvée",
    "etat.refusee": "Refusée",
    "etat.remboursee": "Remboursée",
  },
  en: {
    verrou: "Sign in to manage your expense reports.",
    vueMoi: "My expenses",
    vueValidation: "To approve",
    vueRemboursement: "To reimburse",
    salarie: "Employee",
    sansFicheTitre: "No employee file in your name",
    sansFicheAide:
      "Your account ({email}) is not linked to any HR file. Ask a manager to add your email address to it.",
    noteIncomplete: "Incomplete expense",
    noteSoumise: "Expense submitted",
    noteSoumiseMsg: "{montant} — awaiting approval.",
    notifResponsable: "Expense report — {nom}",
    categorieMontant: "{categorie}: {montant}.",
    soumissionImpossible: "Could not submit",
    recuImpossible: "Could not upload the receipt",
    retirerTitre: "Withdraw this expense?",
    retirer: "Withdraw",
    actionImpossible: "Action failed",
    refuserTitre: "Refuse this expense?",
    refuserMsg: "{nom} — {montant}.",
    refuser: "Refuse",
    approuver: "Approve",
    noteApprouvee: "Expense approved",
    noteRefusee: "Expense refused",
    noteRemboursee: "Expense reimbursed",
    marquerRemboursee: "Mark as reimbursed",
    aucuneAValider: "No expense to approve.",
    rienARembourser: "Nothing to reimburse — all settled.",
    rembourserAide:
      "An approved expense awaits reimbursement: cash, mobile money or transfer, then mark it here. The journal entry is drafted in Accounting.",
    enValidation: "awaiting approval",
    aRembourser: "to reimburse",
    remboursees: "reimbursed",
    soumettreTitre: "Submit an expense",
    champDate: "Date",
    champCategorie: "Category",
    champMontant: "Amount (CFA francs)",
    champDescription: "Description",
    descriptionExemple: "Taxi to a client meeting, Yopougon",
    joindreRecu: "Attach the receipt (photo or PDF)",
    soumettre: "Submit",
    mesNotes: "My expenses",
    aucuneNote: "No expense yet.",
    voirRecu: "· view receipt",
    "categorie.transport": "Transport & taxi",
    "categorie.carburant": "Fuel",
    "categorie.repas": "Meals & entertainment",
    "categorie.hebergement": "Accommodation",
    "categorie.fournitures": "Supplies & small equipment",
    "categorie.communication": "Phone & internet",
    "categorie.autre": "Other expense",
    "etat.soumise": "Pending",
    "etat.approuvee": "Approved",
    "etat.refusee": "Refused",
    "etat.remboursee": "Reimbursed",
  },
};

/// Libellé d'une catégorie ou d'un état : la traduction si elle existe,
/// sinon le libellé français du domaine — un id inconnu ne casse rien.
const libelleCategorie = (t, id) => {
  const traduit = t(`categorie.${id}`);
  return traduit === `categorie.${id}` ? D.CATEGORIES[id]?.label || id : traduit;
};
const libelleEtat = (t, id) => {
  const traduit = t(`etat.${id}`);
  return traduit === `etat.${id}` ? D.ETATS[id]?.label || id : traduit;
};

function FraisApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const peutValider = ["OWNER", "ADMIN"].includes(session.user?.role);
  const t = useTraduction(TEXTES);
  const { montant } = useDevise();

  const [vue, setVue] = useState("moi");
  const [notes, setNotes] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [membres, setMembres] = useState([]);
  const [note, setNote] = useState({ ...D.NOTE_VIDE, date: D.today() });
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const [n, s, m] = await Promise.all([
      api.records.list(manifest.slug, "notes"),
      api.records.list("rh", "salaries").catch(() => []),
      api.members().catch(() => []),
    ]);
    setNotes(n);
    setSalaries(s);
    setMembres(m);
  }, []);
  const etat = useChargement(ouvert, charger);

  const moi = useMemo(
    () => salarieDe(salaries, session.user?.email),
    [salaries, session.user?.email],
  );
  const mesNotes = useMemo(() => (moi ? D.mesNotes(notes, moi.id) : []), [notes, moi]);
  const mesTotaux = useMemo(() => D.totauxDe(mesNotes), [mesNotes]);
  const aValider = useMemo(() => notes.filter((n) => n.data.etat === "soumise"), [notes]);
  const aRembourser = useMemo(
    () => notes.filter((n) => n.data.etat === "approuvee"),
    [notes],
  );

  const nomDe = (salarieId) => {
    const s = salaries.find((x) => x.id === salarieId);
    return s
      ? `${s.data.prenom || ""} ${s.data.nom || ""}`.trim()
      : t("salarie");
  };

  const membreDe = (salarieId) => {
    const s = salaries.find((x) => x.id === salarieId);
    if (!s?.data.email) return null;
    return (
      membres.find((m) => m.email?.toLowerCase() === s.data.email.trim().toLowerCase()) ||
      null
    );
  };

  // ---- Soumettre ----------------------------------------------------------

  const soumettre = async () => {
    const probleme = D.problemeNote(note);
    if (probleme) return modal.alert({ title: t("noteIncomplete"), message: probleme });

    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "notes", {
        salarieId: moi.id,
        date: note.date,
        categorie: note.categorie,
        montant: Number(note.montant),
        description: note.description.trim(),
        justificatif: note.justificatif,
        etat: "soumise",
      });
      setNote({ ...D.NOTE_VIDE, date: D.today() });
      await etat.rafraichir();
      notifier({
        titre: t("noteSoumise"),
        message: t("noteSoumiseMsg", { montant: montant(note.montant) }),
        app: manifest.name,
        ton: "success",
      });
      for (const m of membres.filter((x) => ["OWNER", "ADMIN"].includes(x.role))) {
        envoyerA(m.id, {
          source: "frais",
          titre: t("notifResponsable", { nom: nomDe(moi.id) }),
          message: t("categorieMontant", {
            categorie: libelleCategorie(t, note.categorie),
            montant: montant(note.montant),
          }),
          lien: { app: "frais" },
        });
      }
    } catch (e) {
      modal.alert({ title: t("soumissionImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  /// Le reçu part au cloud dès qu'il est choisi — dossier « Notes de
  /// frais », visible dans l'Explorateur comme tout le reste.
  const joindreRecu = async (fichier) => {
    if (!fichier) return;
    setOccupe(true);
    try {
      const node = await saveToCloud(fichier, fichier.name, { folder: "Notes de frais" });
      setNote((n) => ({
        ...n,
        justificatif: {
          id: node.id,
          name: node.name,
          mimeType: node.mimeType || fichier.type,
          size: node.size,
          type: "FILE",
        },
      }));
    } catch (e) {
      modal.alert({ title: t("recuImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const retirer = async (fiche) => {
    const ok = await modal.confirm({
      title: t("retirerTitre"),
      message: `${montant(fiche.data.montant)} — ${fiche.data.description}`,
      confirmLabel: t("retirer"),
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "notes", fiche.id);
    await etat.rafraichir();
  };

  // ---- Trancher et rembourser --------------------------------------------

  const passer = async (fiche, etatCible, titreNotif) => {
    setOccupe(true);
    try {
      await api.records.update(manifest.slug, "notes", fiche.id, {
        ...fiche.data,
        etat: etatCible,
      });
      await etat.rafraichir();
      const membre = membreDe(fiche.data.salarieId);
      if (membre) {
        envoyerA(membre.id, {
          source: "frais",
          titre: titreNotif,
          message: t("categorieMontant", {
            categorie: libelleCategorie(t, fiche.data.categorie),
            montant: montant(fiche.data.montant),
          }),
          lien: { app: "frais" },
        });
      }
    } catch (e) {
      modal.alert({ title: t("actionImpossible"), message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const refuser = async (fiche) => {
    const ok = await modal.confirm({
      title: t("refuserTitre"),
      message: t("refuserMsg", {
        nom: nomDe(fiche.data.salarieId),
        montant: montant(fiche.data.montant),
      }),
      confirmLabel: t("refuser"),
      danger: true,
    });
    if (ok) passer(fiche, "refusee", t("noteRefusee"));
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="frsApp">
        <div className="frsVerrou">{t("verrou")}</div>
      </ModuleWindow>
    );
  }

  const VUES = [
    { id: "moi", label: t("vueMoi"), icone: "faReceipt" },
    ...(peutValider
      ? [
          { id: "validation", label: t("vueValidation"), icone: "faListCheck", compte: aValider.length },
          { id: "remboursement", label: t("vueRemboursement"), icone: "faMoneyBillTransfer", compte: aRembourser.length },
        ]
      : []),
  ];

  return (
    <ModuleWindow manifest={manifest} className="frsApp">
      <div className="frsShell">
        <nav className="frsNav">
          {VUES.map((v) => (
            <div
              key={v.id}
              className="frsOnglet handcr"
              data-actif={vue === v.id}
              onClick={() => setVue(v.id)}
            >
              <Icon fafa={v.icone} width={13} />
              <span>{v.label}</span>
              {v.compte ? <span className="frsCompte">{v.compte}</span> : null}
            </div>
          ))}
        </nav>

        <div className="frsCentre cosScroll">
          <Contenu etat={etat} vide={false} lignes={4}>
            {vue === "moi" ? (
              !moi ? (
                <Vide
                  icone="faUserSlash"
                  titre={t("sansFicheTitre")}
                  aide={t("sansFicheAide", { email: session.user?.email })}
                />
              ) : (
                <MesNotes
                  totaux={mesTotaux}
                  liste={mesNotes}
                  note={note}
                  setNote={setNote}
                  occupe={occupe}
                  onJoindre={joindreRecu}
                  onSoumettre={soumettre}
                  onRetirer={retirer}
                />
              )
            ) : vue === "validation" ? (
              <ATrancher
                liste={aValider}
                nomDe={nomDe}
                occupe={occupe}
                vide={t("aucuneAValider")}
                actions={(f) => (
                  <>
                    <Bouton icone="faCheck" off={occupe} onClick={() => passer(f, "approuvee", t("noteApprouvee"))}>
                      {t("approuver")}
                    </Bouton>
                    <Bouton variante="secondaire" icone="faXmark" off={occupe} onClick={() => refuser(f)}>
                      {t("refuser")}
                    </Bouton>
                  </>
                )}
              />
            ) : (
              <ATrancher
                liste={aRembourser}
                nomDe={nomDe}
                occupe={occupe}
                vide={t("rienARembourser")}
                aide={t("rembourserAide")}
                actions={(f) => (
                  <Bouton
                    icone="faMoneyBillTransfer"
                    off={occupe}
                    onClick={() => passer(f, "remboursee", t("noteRemboursee"))}
                  >
                    {t("marquerRemboursee")}
                  </Bouton>
                )}
              />
            )}
          </Contenu>
        </div>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Mes notes
// ---------------------------------------------------------------------------

const MesNotes = ({ totaux, liste, note, setNote, occupe, onJoindre, onSoumettre, onRetirer }) => {
  const t = useTraduction(TEXTES);
  const { montant } = useDevise();
  const maj = (patch) => setNote((n) => ({ ...n, ...patch }));
  const fichierRef = useRef(null);

  return (
    <div className="frsMoi">
      <div className="frsTotaux">
        <div className="frsTotal" data-ton="warn">
          <b>{montant(totaux.soumises)}</b>
          <span>{t("enValidation")}</span>
        </div>
        <div className="frsTotal" data-ton="ok">
          <b>{montant(totaux.approuvees)}</b>
          <span>{t("aRembourser")}</span>
        </div>
        <div className="frsTotal">
          <b>{montant(totaux.remboursees)}</b>
          <span>{t("remboursees")}</span>
        </div>
      </div>

      <div className="frsBloc">
        <h3>{t("soumettreTitre")}</h3>
        <div className="frsFormulaire">
          <Champ label={t("champDate")}>
            <input
              type="date"
              value={note.date}
              max={D.today()}
              onChange={(e) => maj({ date: e.target.value })}
            />
          </Champ>
          <Champ label={t("champCategorie")}>
            <select value={note.categorie} onChange={(e) => maj({ categorie: e.target.value })}>
              {Object.keys(D.CATEGORIES).map((id) => (
                <option key={id} value={id}>
                  {libelleCategorie(t, id)}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label={t("champMontant")}>
            <input
              type="number"
              min="0"
              value={note.montant}
              placeholder="4 500"
              onChange={(e) => maj({ montant: e.target.value })}
            />
          </Champ>
          <Champ label={t("champDescription")}>
            <input
              value={note.description}
              placeholder={t("descriptionExemple")}
              onChange={(e) => maj({ description: e.target.value })}
            />
          </Champ>
        </div>

        <div className="frsRecu">
          <input
            ref={fichierRef}
            type="file"
            accept="image/*,.pdf"
            hidden
            onChange={(e) => {
              onJoindre(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {note.justificatif ? (
            <div className="frsRecuChip">
              <Icon fafa="faPaperclip" width={11} />
              <span>{note.justificatif.name}</span>
              <span
                className="frsRecuRetirer handcr"
                onClick={() => maj({ justificatif: null })}
              >
                <Icon fafa="faXmark" width={10} />
              </span>
            </div>
          ) : (
            <Bouton
              variante="secondaire"
              icone="faCamera"
              off={occupe}
              onClick={() => fichierRef.current?.click()}
            >
              {t("joindreRecu")}
            </Bouton>
          )}
          <Bouton icone="faPaperPlane" off={occupe} onClick={onSoumettre}>
            {t("soumettre")}
          </Bouton>
        </div>
      </div>

      <div className="frsBloc">
        <h3>{t("mesNotes")}</h3>
        {!liste.length ? (
          <p className="frsAide">{t("aucuneNote")}</p>
        ) : (
          liste.map((f) => <LigneNote key={f.id} fiche={f} onRetirer={onRetirer} />)
        )}
      </div>
    </div>
  );
};

const LigneNote = ({ fiche, onRetirer }) => {
  const t = useTraduction(TEXTES);
  const { montant } = useDevise();
  const d = fiche.data;
  const e = D.ETATS[d.etat] || {};
  return (
    <div className="frsLigne">
      <span className="frsLigneIcone">
        <Icon fafa={(D.CATEGORIES[d.categorie] || D.CATEGORIES.autre).icone} width={13} />
      </span>
      <div className="frsLigneCorps">
        <span className="frsLigneDesc">{d.description}</span>
        <span className="frsLigneSous">
          {d.date} · {libelleCategorie(t, d.categorie)}
          {d.justificatif ? (
            <span
              className="frsLien handcr"
              onClick={() => ouvrirFichier(d.justificatif, [d.justificatif])}
            >
              {t("voirRecu")}
            </span>
          ) : null}
        </span>
      </div>
      <span className="frsLigneMontant">{montant(d.montant)}</span>
      <span className="frsEtat" data-ton={e.ton}>
        {libelleEtat(t, d.etat)}
      </span>
      {d.etat === "soumise" && onRetirer ? (
        <span className="frsRecuRetirer handcr" title={t("retirer")} onClick={() => onRetirer(fiche)}>
          <Icon fafa="faXmark" width={11} />
        </span>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Les files du responsable — validation et remboursement, même gabarit.
// ---------------------------------------------------------------------------

const ATrancher = ({ liste, nomDe, vide, aide, actions }) => {
  const t = useTraduction(TEXTES);
  const { montant } = useDevise();
  if (!liste.length) {
    return <Vide icone="faListCheck" titre={vide} aide={aide} />;
  }
  return (
    <div className="frsFile">
      {aide ? <p className="frsAide">{aide}</p> : null}
      {liste.map((f) => {
        const d = f.data;
        return (
          <div key={f.id} className="frsCarte">
            <div className="frsCarteHaut">
              <span className="frsCarteNom">{nomDe(d.salarieId)}</span>
              <span className="frsLigneMontant">{montant(d.montant)}</span>
            </div>
            <div className="frsCarteSous">
              {d.date} · {libelleCategorie(t, d.categorie)} — « {d.description} »
              {d.justificatif ? (
                <span
                  className="frsLien handcr"
                  onClick={() => ouvrirFichier(d.justificatif, [d.justificatif])}
                >
                  {t("voirRecu")}
                </span>
              ) : null}
            </div>
            <div className="frsCarteActions">{actions(f)}</div>
          </div>
        );
      })}
    </div>
  );
};
