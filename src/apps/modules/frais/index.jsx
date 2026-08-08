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

function FraisApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";
  const peutValider = ["OWNER", "ADMIN"].includes(session.user?.role);

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
    return s ? `${s.data.prenom || ""} ${s.data.nom || ""}`.trim() : "Salarié";
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
    if (probleme) return modal.alert({ title: "Note incomplète", message: probleme });

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
        titre: "Note soumise",
        message: `${D.fcfa(note.montant)} — en attente de validation.`,
        app: "Notes de frais",
        ton: "success",
      });
      for (const m of membres.filter((x) => ["OWNER", "ADMIN"].includes(x.role))) {
        envoyerA(m.id, {
          source: "frais",
          titre: `Note de frais — ${nomDe(moi.id)}`,
          message: `${D.CATEGORIES[note.categorie]?.label} : ${D.fcfa(note.montant)}.`,
          lien: { app: "frais" },
        });
      }
    } catch (e) {
      modal.alert({ title: "Soumission impossible", message: e.message, tone: "error" });
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
      modal.alert({ title: "Envoi du reçu impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const retirer = async (fiche) => {
    const ok = await modal.confirm({
      title: "Retirer cette note ?",
      message: `${D.fcfa(fiche.data.montant)} — ${fiche.data.description}`,
      confirmLabel: "Retirer",
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
          message: `${D.CATEGORIES[fiche.data.categorie]?.label} : ${D.fcfa(fiche.data.montant)}.`,
          lien: { app: "frais" },
        });
      }
    } catch (e) {
      modal.alert({ title: "Action impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const refuser = async (fiche) => {
    const ok = await modal.confirm({
      title: "Refuser cette note ?",
      message: `${nomDe(fiche.data.salarieId)} — ${D.fcfa(fiche.data.montant)}.`,
      confirmLabel: "Refuser",
      danger: true,
    });
    if (ok) passer(fiche, "refusee", "Note de frais refusée");
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="frsApp">
        <div className="frsVerrou">Connectez-vous pour vos notes de frais.</div>
      </ModuleWindow>
    );
  }

  const VUES = [
    { id: "moi", label: "Mes notes", icone: "faReceipt" },
    ...(peutValider
      ? [
          { id: "validation", label: "À valider", icone: "faListCheck", compte: aValider.length },
          { id: "remboursement", label: "À rembourser", icone: "faMoneyBillTransfer", compte: aRembourser.length },
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

        <div className="frsCentre win11Scroll">
          <Contenu etat={etat} vide={false} lignes={4}>
            {vue === "moi" ? (
              !moi ? (
                <Vide
                  icone="faUserSlash"
                  titre="Aucune fiche salarié à votre nom"
                  aide={`Votre compte (${session.user?.email}) n'est relié à aucune fiche RH. Demandez à un responsable d'y renseigner votre adresse email.`}
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
                vide="Aucune note à valider."
                actions={(f) => (
                  <>
                    <Bouton icone="faCheck" off={occupe} onClick={() => passer(f, "approuvee", "Note de frais approuvée")}>
                      Approuver
                    </Bouton>
                    <Bouton variante="secondaire" icone="faXmark" off={occupe} onClick={() => refuser(f)}>
                      Refuser
                    </Bouton>
                  </>
                )}
              />
            ) : (
              <ATrancher
                liste={aRembourser}
                nomDe={nomDe}
                occupe={occupe}
                vide="Rien à rembourser — tout est soldé."
                aide="Une note approuvée attend son remboursement : espèces, mobile money ou virement, puis marquez-la ici. L'écriture comptable est proposée dans la Comptabilité."
                actions={(f) => (
                  <Bouton
                    icone="faMoneyBillTransfer"
                    off={occupe}
                    onClick={() => passer(f, "remboursee", "Note de frais remboursée")}
                  >
                    Marquer remboursée
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
  const maj = (patch) => setNote((n) => ({ ...n, ...patch }));
  const fichierRef = useRef(null);

  return (
    <div className="frsMoi">
      <div className="frsTotaux">
        <div className="frsTotal" data-ton="warn">
          <b>{D.fcfa(totaux.soumises)}</b>
          <span>en validation</span>
        </div>
        <div className="frsTotal" data-ton="ok">
          <b>{D.fcfa(totaux.approuvees)}</b>
          <span>à rembourser</span>
        </div>
        <div className="frsTotal">
          <b>{D.fcfa(totaux.remboursees)}</b>
          <span>remboursées</span>
        </div>
      </div>

      <div className="frsBloc">
        <h3>Soumettre une dépense</h3>
        <div className="frsFormulaire">
          <Champ label="Date">
            <input
              type="date"
              value={note.date}
              max={D.today()}
              onChange={(e) => maj({ date: e.target.value })}
            />
          </Champ>
          <Champ label="Catégorie">
            <select value={note.categorie} onChange={(e) => maj({ categorie: e.target.value })}>
              {Object.entries(D.CATEGORIES).map(([id, c]) => (
                <option key={id} value={id}>
                  {c.label}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Montant (F CFA)">
            <input
              type="number"
              min="0"
              value={note.montant}
              placeholder="4 500"
              onChange={(e) => maj({ montant: e.target.value })}
            />
          </Champ>
          <Champ label="Description">
            <input
              value={note.description}
              placeholder="Taxi rendez-vous client, Yopougon"
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
              Joindre le reçu (photo ou PDF)
            </Bouton>
          )}
          <Bouton icone="faPaperPlane" off={occupe} onClick={onSoumettre}>
            Soumettre
          </Bouton>
        </div>
      </div>

      <div className="frsBloc">
        <h3>Mes notes</h3>
        {!liste.length ? (
          <p className="frsAide">Aucune note pour l'instant.</p>
        ) : (
          liste.map((f) => <LigneNote key={f.id} fiche={f} onRetirer={onRetirer} />)
        )}
      </div>
    </div>
  );
};

const LigneNote = ({ fiche, onRetirer }) => {
  const d = fiche.data;
  const e = D.ETATS[d.etat] || {};
  const c = D.CATEGORIES[d.categorie] || D.CATEGORIES.autre;
  return (
    <div className="frsLigne">
      <span className="frsLigneIcone">
        <Icon fafa={c.icone} width={13} />
      </span>
      <div className="frsLigneCorps">
        <span className="frsLigneDesc">{d.description}</span>
        <span className="frsLigneSous">
          {d.date} · {c.label}
          {d.justificatif ? (
            <span
              className="frsLien handcr"
              onClick={() => ouvrirFichier(d.justificatif, [d.justificatif])}
            >
              · voir le reçu
            </span>
          ) : null}
        </span>
      </div>
      <span className="frsLigneMontant">{D.fcfa(d.montant)}</span>
      <span className="frsEtat" data-ton={e.ton}>
        {e.label || d.etat}
      </span>
      {d.etat === "soumise" && onRetirer ? (
        <span className="frsRecuRetirer handcr" title="Retirer" onClick={() => onRetirer(fiche)}>
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
  if (!liste.length) {
    return <Vide icone="faListCheck" titre={vide} aide={aide} />;
  }
  return (
    <div className="frsFile">
      {aide ? <p className="frsAide">{aide}</p> : null}
      {liste.map((f) => {
        const d = f.data;
        const c = D.CATEGORIES[d.categorie] || D.CATEGORIES.autre;
        return (
          <div key={f.id} className="frsCarte">
            <div className="frsCarteHaut">
              <span className="frsCarteNom">{nomDe(d.salarieId)}</span>
              <span className="frsLigneMontant">{D.fcfa(d.montant)}</span>
            </div>
            <div className="frsCarteSous">
              {d.date} · {c.label} — « {d.description} »
              {d.justificatif ? (
                <span
                  className="frsLien handcr"
                  onClick={() => ouvrirFichier(d.justificatif, [d.justificatif])}
                >
                  · voir le reçu
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
