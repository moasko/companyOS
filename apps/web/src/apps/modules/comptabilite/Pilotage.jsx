// Comptabilité — le pilotage et la boîte « À traiter ».

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import * as D from "./domaine";
import { journalDe } from "./journaux";
import { tresorerieParMois } from "./etats";
import { bilanControles, controlesCloture, moisAClore, moisSuivant, nomMois } from "./cloture";
import {
  Bouton,
  Carte,
  Entete,
  Kpi,
  LignesEcriture,
  Origine,
  aujourdhui,
  dateCourte,
  dateFr,
  nb,
  ouvrirPiece,
  useCpt,
} from "./commun";

// ---------------------------------------------------------------------------
// Statut de la période
// ---------------------------------------------------------------------------

export const StatutPeriode = () => {
  const { clotureAu, reglages } = useCpt();
  const dernier = [...(reglages.historique || [])].reverse().find((h) => !h.reouverture && h.au === clotureAu);
  return (
    <span className="cptStatut" data-ouvert="true">
      <span className="cptStatutPoint" aria-hidden="true" />
      <b>Période ouverte</b>
      {clotureAu ? (
        <small>
          {nomMois(clotureAu.slice(0, 7), { annee: false })} verrouillé
          {dernier ? ` le ${dateFr(dernier.le)}${dernier.par ? ` par ${dernier.par}` : ""}` : ""}
        </small>
      ) : (
        <small>aucun mois verrouillé</small>
      )}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Liste « à traiter »
// ---------------------------------------------------------------------------

export const ListeTaches = ({ taches, compacte }) => {
  const { aller } = useCpt();
  if (!taches.length) {
    return (
      <div className="cptRienAFaire">
        <Icon fafa="faCircleCheck" width={18} />
        <div>
          <b>Rien en attente</b>
          <span>Toutes les pièces des autres applications sont au journal.</span>
        </div>
      </div>
    );
  }
  return (
    <ul className="cptTaches" data-compacte={compacte ? "true" : "false"}>
      {taches.map((t) => (
        <li key={t.id}>
          <span className="cptTacheN" data-ton={t.ton}>{t.n}</span>
          <span className="cptTacheTexte">
            <b>{t.titre}</b>
            <small>{t.detail}</small>
          </span>
          <Bouton
            onClick={() =>
              aller(t.section, {
                ...(t.compte ? { compte: t.compte } : {}),
                ...(t.mois ? { mois: t.mois } : {}),
                ...(t.filtre ? { filtre: t.filtre } : {}),
              })
            }
          >
            {t.action}
          </Bouton>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Pilotage
// ---------------------------------------------------------------------------

export const Pilotage = () => {
  const {
    ecritures,
    contexte,
    periode,
    taches,
    clientsAges,
    suggerees,
    relevesParCompte,
    lettres,
    reglages,
    clotureAu,
    aller,
    contrepasser,
  } = useCpt();
  const jour = aujourdhui();
  const moisCourant = jour.slice(0, 7);

  const treso = useMemo(() => D.tresorerie(ecritures, { axe: contexte.axe }), [ecritures, contexte.axe]);
  const resultat = useMemo(() => D.compteDeResultat(ecritures, contexte), [ecritures, contexte]);
  const tvaMois = useMemo(() => D.tva(ecritures, { ...D.mois(moisCourant), axe: contexte.axe }), [ecritures, moisCourant, contexte.axe]);
  const courbe = useMemo(() => tresorerieParMois(ecritures, moisCourant, 6), [ecritures, moisCourant]);

  const aEncaisser = clientsAges.reduce((s, c) => s + c.total, 0);
  const enRetard = clientsAges.reduce((s, c) => s + c.j30 + c.j60 + c.j90 + c.plus, 0);

  const mois = moisAClore(clotureAu, jour);
  const controles = useMemo(
    () =>
      controlesCloture({
        mois,
        ecritures,
        suggerees,
        releves: relevesParCompte,
        lettres,
        tvaDeclarees: reglages.tvaDeclarees || {},
      }),
    [mois, ecritures, suggerees, relevesParCompte, lettres, reglages.tvaDeclarees],
  );
  const synthese = bilanControles(controles);

  const dernieres = useMemo(
    () =>
      [...ecritures]
        .sort(
          (a, b) =>
            String(b.data.date).localeCompare(String(a.data.date)) ||
            String(b.createdAt || "").localeCompare(String(a.createdAt || "")),
        )
        .slice(0, 6),
    [ecritures],
  );

  const max = Math.max(1, ...courbe.map((m) => Math.abs(m.total)));
  const annee = (periode.du || "").slice(0, 4);

  return (
    <div className="cptVue">
      <Entete
        retour={false}
        titre="Pilotage"
        sous={`Exercice ${annee} · ${nomMois(moisCourant, { annee: false })}`}
      >
        <StatutPeriode />
        <Bouton icone="faFileImport" onClick={() => aller("banque", { importer: true })}>
          Importer un relevé
        </Bouton>
        <Bouton variante="principal" icone="faPlus" onClick={() => aller("saisie")}>
          Nouvelle pièce
        </Bouton>
      </Entete>

      <div className="cptConteneur">
        <section className="cptKpis" aria-label="Indicateurs">
          <Kpi
            label="Trésorerie"
            valeur={D.fcfa(treso.total)}
            ton={treso.total < 0 ? "danger" : ""}
            aide={
              treso.comptes.length
                ? treso.comptes.map((c) => `${D.intitule(c.compte)} ${nb(c.montant)}`).join(" · ")
                : "Aucun mouvement de banque ni de caisse"
            }
            onClick={() => aller("banque")}
          />
          <Kpi
            label="Résultat de la période"
            valeur={D.fcfa(resultat.resultat)}
            ton={resultat.resultat >= 0 ? "ok" : "danger"}
            aide={`${nb(resultat.totalProduits)} de produits, ${nb(resultat.totalCharges)} de charges`}
            onClick={() => aller("etats")}
          />
          <Kpi
            label={tvaMois.aPayer ? "TVA à reverser" : "Crédit de TVA"}
            valeur={D.fcfa(tvaMois.aPayer || tvaMois.credit)}
            ton={tvaMois.aPayer ? "attention" : ""}
            aide={`${nomMois(moisCourant, { annee: false })} — déclaration avant le 15 ${nomMois(moisSuivant(moisCourant), { annee: false })}`}
            onClick={() => aller("tva")}
          />
          <Kpi
            label="Clients — à encaisser"
            valeur={D.fcfa(aEncaisser)}
            aide={enRetard ? `dont ${nb(enRetard)} échus` : "Rien d'échu"}
            ton={enRetard ? "attention" : ""}
            onClick={() => aller("tiers")}
          />
        </section>

        <div className="cptGrille">
          <Carte
            className="cptLarge"
            titre={`À traiter · ${taches.length} sujet${taches.length > 1 ? "s" : ""}`}
            aide="Classé par urgence"
          >
            <ListeTaches taches={taches} />
          </Carte>

          <div className="cptColonne">
            <Carte titre="Trésorerie fin de mois" aide="Banque, mobile money et caisse">
              <div className="cptCourbe" role="img" aria-label={courbe.map((m) => `${nomMois(m.mois)} : ${nb(m.total)}`).join(", ")}>
                {courbe.map((m, i) => (
                  <div key={m.mois} className="cptCourbeCol" title={`${nomMois(m.mois)} : ${nb(m.total)}`}>
                    <small>{i === courbe.length - 1 ? nb(m.total) : ""}</small>
                    <span className="cptCourbePiste">
                      <span
                        className="cptCourbeBarre"
                        data-dernier={i === courbe.length - 1 ? "true" : "false"}
                        data-negatif={m.total < 0 ? "true" : "false"}
                        style={{ height: `${Math.max(2, (Math.abs(m.total) / max) * 100)}%` }}
                      />
                    </span>
                    <span>{nomMois(m.mois, { annee: false }).slice(0, 4)}</span>
                  </div>
                ))}
              </div>
            </Carte>

            <Carte titre={`Clôture de ${nomMois(mois, { annee: false })}`}>
              <div className="cptProgres">
                <span className="cptProgresPiste">
                  <span style={{ width: `${(synthese.ok / synthese.total) * 100}%` }} />
                </span>
                <b>
                  {synthese.ok} / {synthese.total}
                </b>
              </div>
              <p className="cptAide">
                {synthese.verrouillable
                  ? "Aucun point bloquant : le mois peut être verrouillé."
                  : `${synthese.bloquants.length} point(s) bloquant(s) avant de verrouiller.`}
              </p>
              <button type="button" className="cptLien" onClick={() => aller("cloture")}>
                Ouvrir l'assistant de clôture →
              </button>
            </Carte>
          </div>
        </div>

        <Carte
          titre="Dernières pièces"
          actions={
            <button type="button" className="cptLien" onClick={() => aller("journal")}>
              Tout le journal →
            </button>
          }
        >
          {dernieres.length ? (
            <div className="cptTableau" role="table">
              <div className="cptLigneT cptEnteteT cptCols7" role="row">
                <span>Date</span>
                <span>Journal</span>
                <span>Pièce</span>
                <span>Libellé</span>
                <span className="cptMt">Débit</span>
                <span className="cptMt">Crédit</span>
                <span>Origine</span>
              </div>
              {dernieres.map((e) => {
                const t = D.totauxEcriture(e.data);
                return (
                  <button
                    type="button"
                    key={e.id}
                    className="cptLigneT cptCols7"
                    role="row"
                    onClick={() => ouvrirPiece(e, { onContrepasser: contrepasser })}
                  >
                    <span>{dateCourte(e.data.date)}</span>
                    <span className="cptJournal">{journalDe(e)}</span>
                    <span className="cptCode">{e.data.numero || e.data.piece || "—"}</span>
                    <span className="cptEllipse">{e.data.libelle}</span>
                    <span className="cptMt">{nb(t.debit)}</span>
                    <span className="cptMt">{nb(t.credit)}</span>
                    <span><Origine e={e} /></span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="cptRien">Aucune écriture pour l'instant. Commencez par « À traiter » : vos factures y attendent.</p>
          )}
        </Carte>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// À traiter
// ---------------------------------------------------------------------------

const ORDRE_SOURCES = ["Facturation", "Caisse", "Achats", "Paie", "Notes de frais"];

export const ATraiter = () => {
  const { suggerees, taches, accepterListe, occupe, clotureAu } = useCpt();
  const [ouverte, setOuverte] = useState(null);

  const groupes = useMemo(() => {
    const m = new Map();
    for (const s of suggerees) {
      const src = s.source || "Autre";
      if (!m.has(src)) m.set(src, []);
      m.get(src).push(s);
    }
    const rang = (src) => (ORDRE_SOURCES.includes(src) ? ORDRE_SOURCES.indexOf(src) : 99);
    return [...m.entries()].sort((a, b) => rang(a[0]) - rang(b[0]));
  }, [suggerees]);

  const autres = taches.filter((t) => t.id !== "reprises");

  return (
    <div className="cptVue">
      <Entete titre="À traiter" sous={`${suggerees.length} opération(s) des autres applications`}>
        <Bouton
          variante="principal"
          icone="faCheckDouble"
          disabled={occupe || !suggerees.length}
          onClick={() => accepterListe(suggerees)}
        >
          Tout comptabiliser ({suggerees.length})
        </Bouton>
      </Entete>

      <div className="cptConteneur">
        {autres.length ? (
          <Carte titre="Autres sujets">
            <ListeTaches taches={autres} compacte />
          </Carte>
        ) : null}

        {!groupes.length ? (
          <Carte>
            <ListeTaches taches={[]} />
          </Carte>
        ) : (
          groupes.map(([source, liste]) => (
            <Carte
              key={source}
              titre={`${source} · ${liste.length}`}
              aide={
                source === "Facturation"
                  ? "Factures émises et règlements encaissés. La facture crée la créance, le règlement l'éteint."
                  : source === "Caisse"
                    ? "Tickets de caisse : ventes au comptoir, encaissées sur-le-champ."
                    : source === "Achats"
                      ? "Factures fournisseur reçues et paiements."
                      : source === "Paie"
                        ? "Bulletins de paie : salaires, cotisations CNPS et impôts retenus."
                        : "Pièces proposées par une autre application."
              }
              actions={
                <Bouton icone="faCheck" disabled={occupe} onClick={() => accepterListe(liste)}>
                  Comptabiliser ces {liste.length}
                </Bouton>
              }
            >
              <ul className="cptReprises">
                {liste.slice(0, 60).map((s) => {
                  const t = D.totauxEcriture(s);
                  const cle = s.origine;
                  const close = D.estClos(s.date, clotureAu);
                  return (
                    <li key={cle} data-ouvert={ouverte === cle ? "true" : "false"}>
                      <button
                        type="button"
                        className="cptReprise"
                        aria-expanded={ouverte === cle}
                        onClick={() => setOuverte(ouverte === cle ? null : cle)}
                      >
                        <span className="cptJournal">{s.journal || journalDe(s)}</span>
                        <span className="cptRepriseDate">{dateCourte(s.date)}</span>
                        <span className="cptEllipse">{s.libelle}</span>
                        {close ? <em className="cptEtiquette" data-ton="rouge">période close</em> : null}
                        <b className="cptMt">{nb(t.debit)}</b>
                        <Icon fafa={ouverte === cle ? "faChevronUp" : "faChevronDown"} width={10} />
                      </button>
                      {ouverte === cle ? (
                        <div className="cptRepriseDetail">
                          <LignesEcriture lignes={s.lignes} />
                          <div className="cptRepriseActions">
                            <small>
                              Pièce {s.piece || "—"}
                              {s.tiers ? ` · ${s.tiers}` : ""}
                            </small>
                            <Bouton
                              variante="principal"
                              icone="faCheck"
                              disabled={occupe || close}
                              onClick={() => accepterListe([s], { confirmer: false })}
                            >
                              Comptabiliser
                            </Bouton>
                          </div>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {liste.length > 60 ? <p className="cptAide">… et {liste.length - 60} autre(s), comptabilisées avec le bouton du groupe.</p> : null}
            </Carte>
          ))
        )}
      </div>
    </div>
  );
};
