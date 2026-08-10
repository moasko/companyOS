// Agenda.
//
// ─────────────────────────────────────────────────────────────────────────
// CE QUE CETTE APPLICATION RASSEMBLE
//
// Les dates de l'entreprise vivaient chacune dans son coin : l'échéance
// d'une facture dans la Facturation, la date d'une tâche dans les Projets,
// un congé dans les RH. Aucun endroit ne les montrait ensemble — on
// découvrait un retard le jour même.
//
// L'Agenda les réunit sans les copier. Il lit les autres modules et en
// déduit des événements (voir domaine.js) ; déplacer un congé dans les RH
// le déplace ici, parce que la source de vérité reste le module d'origine.
// Ces événements repris sont en lecture seule et s'ouvrent d'un clic dans
// leur app. À côté, l'agenda tient ses propres rendez-vous, que l'on crée
// et modifie ici.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { ouvrirFenetre } from "../../windows";
import { saveToCloud } from "../../cloud";
import { composerCourriel } from "../../courrielRequest";
import { Contenu, useChargement } from "../../chargement";
import { Bouton } from "../../ui";
import * as D from "./domaine";
import "./agenda.scss";

export const manifest = {
  id: "agenda",
  slug: "agenda",
  name: "Agenda",
  icon: "agenda",
  action: "AGENDAAPP",
  Window: AgendaApp,
};

/// Date du jour, en ISO local (surtout pas en UTC : ici on veut « le jour de
/// l'utilisateur », pas celui de Greenwich).
const aujourdhuiIso = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function AgendaApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const today = aujourdhuiIso();
  const [repris, setRepris] = useState([]);
  const [propres, setPropres] = useState([]);
  const [caches, setCaches] = useState(() => new Set()); // familles masquées
  const [ancre, setAncre] = useState(today); // n'importe quel jour du mois affiché
  const [jourActif, setJourActif] = useState(today);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    const lire = (m, c) => api.records.list(m, c).catch(() => []);
    const [fac, cartes, activites, absences, salaries, bulletins, evenements] = await Promise.all([
      lire("facturation", "factures"),
      lire("projets", "cartes"),
      lire("crm", "activites"),
      lire("rh", "absences"),
      lire("rh", "salaries"),
      lire("paie", "bulletins"),
      lire(manifest.slug, "evenements"),
    ]);

    // Table matricule/id → nom, pour nommer congés et fins de contrat.
    const nomSalaries = new Map();
    for (const s of salaries) {
      nomSalaries.set(s.id, `${s.data.prenom || ""} ${s.data.nom || ""}`.trim() || "Salarié");
    }

    setRepris(
      D.evenementsRepris(
        {
          factures: fac,
          taches: cartes,
          relances: activites,
          absences,
          contrats: salaries,
          paie: bulletins,
        },
        { salaries: nomSalaries },
      ),
    );
    setPropres(D.evenementsPropres(evenements));
  }, []);
  const etat = useChargement(ouvert, charger);

  // Tous les événements, filtrés par familles masquées.
  const evenements = useMemo(
    () => [...repris, ...propres].filter((e) => !caches.has(e.famille)),
    [repris, propres, caches],
  );

  const [annee, mois] = useMemo(() => {
    const [a, m] = ancre.split("-");
    return [Number(a), Number(m)];
  }, [ancre]);

  const semaines = useMemo(() => D.grilleMois(annee, mois), [annee, mois]);
  const evenementsDuJour = useMemo(() => D.duJour(evenements, jourActif), [evenements, jourActif]);
  const aVenir = useMemo(() => D.prochains(evenements, today, 8), [evenements, today]);

  const changerMois = (pas) => {
    const d = new Date(Date.UTC(annee, mois - 1 + pas, 1));
    setAncre(d.toISOString().slice(0, 10));
  };
  const revenirAujourdhui = () => {
    setAncre(today);
    setJourActif(today);
  };

  const basculerFamille = (f) =>
    setCaches((prev) => {
      const s = new Set(prev);
      s.has(f) ? s.delete(f) : s.add(f);
      return s;
    });

  // ---- Événements propres : créer / modifier / supprimer ------------------

  const editer = async (evenement) => {
    const existant = evenement?.record?.data;
    const donnees = await modal.open({
      title: existant ? "Modifier l'événement" : "Nouvel événement",
      render: ({ close }) => (
        <FormEvenement defaut={existant} jour={jourActif} onValider={close} />
      ),
    });
    if (!donnees) return;
    setOccupe(true);
    try {
      if (evenement?.record) {
        await api.records.update(manifest.slug, "evenements", evenement.record.id, donnees);
      } else {
        await api.records.create(manifest.slug, "evenements", donnees);
      }
      setJourActif(donnees.date);
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const supprimer = async (evenement) => {
    const ok = await modal.confirm({
      title: "Supprimer cet événement ?",
      message: `« ${evenement.titre} » sera retiré de votre agenda.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.records.remove(manifest.slug, "evenements", evenement.record.id);
    await etat.rafraichir();
  };

  /// Un clic sur un événement : les siens s'éditent, les repris ouvrent leur
  /// app d'origine — là où on peut vraiment les changer.
  const activer = (evenement) => {
    if (evenement.lectureSeule) ouvrirFenetre(evenement.app);
    else editer(evenement);
  };

  /// Inviter par mail : l'événement devient un fichier .ics dans le cloud,
  /// joint à un courriel prérempli. Le destinataire clique, son calendrier
  /// — Outlook, Gmail, un téléphone — propose d'ajouter le rendez-vous.
  const inviter = async (evenement) => {
    setOccupe(true);
    try {
      const ics = D.icsDe(evenement, {
        organisateur: session.tenant?.name || "CompanyOS",
        uid: `${evenement.id}@companyos`,
      });
      const nom = `invitation-${evenement.date}-${evenement.titre
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")}.ics`;
      const node = await saveToCloud(
        new Blob([ics], { type: "text/calendar;charset=utf-8" }),
        nom,
        { folder: "Agenda" },
      );
      composerCourriel({
        sujet: `Invitation : ${evenement.titre} — ${D.dateLisible(evenement.date)}`,
        texte: [
          "Bonjour,",
          "",
          `Vous êtes invité(e) : ${evenement.titre}`,
          `Le ${D.dateLisible(evenement.date)}${evenement.heure ? ` à ${evenement.heure}` : ""}${evenement.detail ? ` — ${evenement.detail}` : ""}.`,
          "",
          "La pièce jointe ajoute le rendez-vous à votre calendrier d'un clic.",
          "",
          "Cordialement,",
          session.user?.name || "",
        ].join("\n"),
        pieces: [{ id: node.id, nom: node.name }],
      });
    } catch (e) {
      modal.alert({ title: "Invitation impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="agdApp">
        <div className="agdVerrou">Connectez-vous pour consulter l'agenda.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="agdApp">
      <div className="agdShell">
        <div className="agdCal">
          <div className="agdBarre">
            <div className="agdNav">
              <button className="agdRond handcr" onClick={() => changerMois(-1)} title="Mois précédent">
                <Icon fafa="faChevronLeft" width={12} />
              </button>
              <button className="agdRond handcr" onClick={() => changerMois(1)} title="Mois suivant">
                <Icon fafa="faChevronRight" width={12} />
              </button>
              <h2 className="agdTitre">
                {D.MOIS_FR[mois - 1]} <span>{annee}</span>
              </h2>
            </div>
            <div className="agdBarreFin">
              <Bouton variante="secondaire" icone="faLocationCrosshairs" onClick={revenirAujourdhui}>
                Aujourd'hui
              </Bouton>
              <Bouton icone="faPlus" off={occupe} onClick={() => editer(null)}>
                Événement
              </Bouton>
            </div>
          </div>

          <div className="agdGrille">
            {D.JOURS_FR.map((j) => (
              <div key={j} className="agdEntete">
                {j}
              </div>
            ))}
            {semaines.flat().map((c) => {
              const duJour = D.duJour(evenements, c.iso);
              return (
                <div
                  key={c.iso}
                  className="agdCase handcr"
                  data-hors={!c.duMois}
                  data-aujourdhui={c.iso === today}
                  data-actif={c.iso === jourActif}
                  onClick={() => setJourActif(c.iso)}
                  onDoubleClick={() => {
                    setJourActif(c.iso);
                    editer(null);
                  }}
                >
                  <span className="agdNum">{c.jour}</span>
                  <div className="agdPuces">
                    {duJour.slice(0, 3).map((e) => (
                      <div
                        key={e.id}
                        className="agdPuce"
                        style={{ "--c": D.FAMILLES[e.famille].couleur }}
                        title={e.titre}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          activer(e);
                        }}
                      >
                        {e.heure ? <b>{e.heure}</b> : null}
                        <span>{e.titre}</span>
                      </div>
                    ))}
                    {duJour.length > 3 ? (
                      <div className="agdPlus">+{duJour.length - 3}</div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="agdLegende">
            {Object.entries(D.FAMILLES).map(([id, f]) => (
              <button
                key={id}
                className="agdFiltre handcr"
                data-off={caches.has(id)}
                style={{ "--c": f.couleur }}
                onClick={() => basculerFamille(id)}
                title={caches.has(id) ? "Afficher" : "Masquer"}
              >
                <i />
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <aside className="agdPanneau cosScroll">
          <div className="agdJour">
            <div className="agdJourTete">
              <div>
                <div className="agdJourDate">{D.dateLisible(jourActif)}</div>
                <div className="agdJourAn">{jourActif.slice(0, 4)}</div>
              </div>
              <button className="agdRond handcr" title="Ajouter ce jour" onClick={() => editer(null)}>
                <Icon fafa="faPlus" width={12} />
              </button>
            </div>

            <Contenu etat={etat} vide={!evenementsDuJour.length} lignes={3} rendreVide={() => (
              <div className="agdVide">Rien de prévu ce jour.</div>
            )}>
              {evenementsDuJour.map((e) => (
                <Evenement
                  key={e.id}
                  e={e}
                  onActiver={() => activer(e)}
                  onSupprimer={() => supprimer(e)}
                  onInviter={() => inviter(e)}
                />
              ))}
            </Contenu>
          </div>

          <div className="agdAvenir">
            <h3>À venir</h3>
            {aVenir.length ? (
              aVenir.map((e) => (
                <button
                  key={e.id}
                  className="agdMini handcr"
                  style={{ "--c": D.FAMILLES[e.famille].couleur }}
                  onClick={() => {
                    setAncre(e.date);
                    setJourActif(e.date);
                  }}
                >
                  <span className="agdMiniJour">
                    <b>{Number(e.date.slice(8, 10))}</b>
                    {D.MOIS_FR[Number(e.date.slice(5, 7)) - 1].slice(0, 3)}
                  </span>
                  <span className="agdMiniTitre">{e.titre}</span>
                </button>
              ))
            ) : (
              <div className="agdVide">Aucune échéance à l'horizon.</div>
            )}
          </div>
        </aside>
      </div>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Une ligne d'événement dans le détail du jour.
// ---------------------------------------------------------------------------

const Evenement = ({ e, onActiver, onSupprimer, onInviter }) => (
  <div className="agdEvt" style={{ "--c": D.FAMILLES[e.famille].couleur }}>
    <div className="agdEvtCorps handcr" onClick={onActiver}>
      <div className="agdEvtHaut">
        {e.heure ? <span className="agdEvtHeure">{e.heure}</span> : null}
        <span className="agdEvtTitre">{e.titre}</span>
      </div>
      <div className="agdEvtBas">
        <span className="agdEvtSource">{D.FAMILLES[e.famille].label}</span>
        {e.detail ? <span className="agdEvtDetail">· {e.detail}</span> : null}
        {e.fin && e.fin !== e.date ? (
          <span className="agdEvtDetail">· jusqu'au {D.dateLisible(e.fin)}</span>
        ) : null}
        {e.provisoire ? <span className="agdEvtProv">à confirmer</span> : null}
      </div>
    </div>
    {e.lectureSeule ? (
      <span className="agdEvtLien" title="Ouvrir dans son application" onClick={onActiver}>
        <Icon fafa="faArrowUpRightFromSquare" width={11} />
      </span>
    ) : (
      <>
        <button
          className="agdEvtSuppr handcr"
          title="Inviter par mail (.ics)"
          onClick={onInviter}
        >
          <Icon fafa="faEnvelope" width={11} />
        </button>
        <button className="agdEvtSuppr handcr" title="Supprimer" onClick={onSupprimer}>
          <Icon fafa="faTrashCan" width={11} />
        </button>
      </>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Formulaire d'un événement propre — ouvert dans une modale.
// ---------------------------------------------------------------------------

const FormEvenement = ({ defaut, jour, onValider }) => {
  const [titre, setTitre] = useState(defaut?.titre || "");
  const [date, setDate] = useState(defaut?.date || jour);
  const [heure, setHeure] = useState(defaut?.heure || "");
  const [fin, setFin] = useState(defaut?.fin || "");
  const [lieu, setLieu] = useState(defaut?.lieu || "");

  const soumettre = () => {
    const t = titre.trim();
    if (!t || !date) return;
    onValider({
      titre: t,
      date,
      heure: heure || "",
      // Une fin n'a de sens que si elle suit le début ; sinon c'est un
      // événement d'un seul jour.
      fin: fin && fin > date ? fin : "",
      lieu: lieu.trim(),
    });
  };

  return (
    <div className="agdForm">
      <label className="agdFormLigne">
        <span>Intitulé</span>
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Réunion, rendez-vous, rappel…"
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && soumettre()}
        />
      </label>
      <div className="agdFormDeux">
        <label className="agdFormLigne">
          <span>Date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="agdFormLigne">
          <span>Heure</span>
          <input type="time" value={heure} onChange={(e) => setHeure(e.target.value)} />
        </label>
      </div>
      <label className="agdFormLigne">
        <span>Jusqu'au <em>(facultatif)</em></span>
        <input type="date" value={fin} min={date} onChange={(e) => setFin(e.target.value)} />
      </label>
      <label className="agdFormLigne">
        <span>Lieu ou note</span>
        <input value={lieu} onChange={(e) => setLieu(e.target.value)} placeholder="Bureau, en visio…" />
      </label>
      <div className="agdFormActions">
        <button className="cosmPrimary handcr" onClick={soumettre} disabled={!titre.trim()}>
          Enregistrer
        </button>
      </div>
    </div>
  );
};
