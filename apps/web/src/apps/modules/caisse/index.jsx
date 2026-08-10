// Caisse — point de vente.
//
// ─────────────────────────────────────────────────────────────────────────
// L'APPLICATION QUI MANQUAIT
//
// Une boutique d'Adjamé vend en face-à-face toute la journée. La
// Facturation sert à émettre une pièce à un client identifié, avec un
// délai ; elle n'est pas faite pour trente ventes à la suite pendant
// qu'une file attend. C'est un autre métier, et il a ses propres règles —
// voir domaine.js.
//
// CE QUE CETTE APP NE RESSAISIT PAS
//
// Les produits viennent du Stock, catalogue partagé de l'entreprise. Une
// vente écrit un mouvement de sortie : le stock baisse tout seul. Elle
// propose son écriture à la Comptabilité, marquée de son origine. La
// caisse ne tient donc qu'une chose que personne d'autre ne tient : le
// ticket, et la session qui le contient.
//
// TROIS PARTIS PRIS D'INTERFACE
//
//   - **Grande cible tactile.** On tape sur un produit, il entre au
//     ticket. Pas de formulaire, pas de client à choisir.
//   - **Le rendu de monnaie en très gros.** C'est l'erreur la plus
//     coûteuse d'un comptoir, et la seule chose que le caissier doit lire
//     de loin, la main dans le tiroir.
//   - **La caisse se compte, elle ne se déclare pas.** À la fermeture, on
//     saisit les coupures une par une et l'écart se constate. Une caisse
//     qui tombe toujours juste ne prouve rien.
// ─────────────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { ModuleWindow } from "../../ModuleWindow";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Contenu, useChargement } from "../../chargement";
import { Bouton, Champ, Notice, Vide } from "../../ui";
import {
  chargerReferentiel,
  filtrerProduits,
  invaliderReferentiel,
} from "../../referentiel";
import * as D from "./domaine";
import "./caisse.scss";

export const manifest = {
  id: "caisse",
  slug: "caisse",
  name: "Caisse",
  icon: "caisse",
  action: "CAISSEAPP",
  Window: CaisseApp,
};

const TICKET_VIDE = () => ({ lignes: [], remiseGlobale: 0, date: D.today() });

function CaisseApp() {
  const wnapp = useSelector((state) => state.apps[manifest.id]);
  const session = useSelector((state) => state.session);
  const ouvert = !!wnapp && !wnapp.hide && session.status === "authenticated";

  const [catalogue, setCatalogue] = useState({ produits: [], categories: [], stocks: {} });
  const [sessions, setSessions] = useState([]);
  const [tickets, setTickets] = useState([]);

  const [ticket, setTicket] = useState(TICKET_VIDE);
  const [recherche, setRecherche] = useState("");
  const [categorie, setCategorie] = useState("");
  const [ecran, setEcran] = useState("vente"); // vente | paiement | fermeture
  const [paiements, setPaiements] = useState([]);
  const [comptage, setComptage] = useState({});
  const [occupe, setOccupe] = useState(false);
  const champRecherche = useRef(null);

  const charger = useCallback(async () => {
    const [ref, s, t] = await Promise.all([
      chargerReferentiel(),
      api.records.list(manifest.slug, "sessions"),
      api.records.list(manifest.slug, "tickets"),
    ]);
    setCatalogue(ref);
    setSessions(s);
    setTickets(t);
  }, []);
  const etat = useChargement(ouvert, charger);

  /// La session ouverte, s'il y en a une. Une seule à la fois : deux
  /// caisses ouvertes en parallèle rendraient tout comptage ininterprétable.
  const active = useMemo(
    () => sessions.find((s) => !s.data.fermeeLe) || null,
    [sessions],
  );

  const produits = useMemo(() => {
    let liste = catalogue.produits || [];
    if (categorie) liste = liste.filter((p) => p.data.categorieId === categorie);
    return filtrerProduits(liste, recherche);
  }, [catalogue.produits, categorie, recherche]);

  const t = useMemo(() => D.totaux(ticket), [ticket]);
  const s = useMemo(() => D.solde(ticket, paiements), [ticket, paiements]);

  // ---- Session ------------------------------------------------------------

  const ouvrirSession = async () => {
    const saisie = await modal.prompt({
      title: "Ouvrir la caisse",
      label: "Fond de caisse",
      detail:
        "Ce que contient le tiroir avant la première vente. C'est à partir de ce montant que l'écart sera calculé ce soir.",
      value: "0",
      confirmLabel: "Ouvrir la caisse",
    });
    if (saisie === null) return;
    setOccupe(true);
    try {
      await api.records.create(manifest.slug, "sessions", {
        fond: Number(saisie) || 0,
        date: D.today(),
        ouverteLe: new Date().toISOString(),
      });
      await etat.rafraichir();
    } catch (e) {
      modal.alert({ title: "Ouverture impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  const fermerSession = async () => {
    const attendu = D.attenduEnCaisse(active, tickets);
    const compte = D.totalComptage(comptage);
    const e = compte - attendu;

    const ok = await modal.confirm({
      title: "Fermer la caisse ?",
      message:
        e === 0
          ? `Le comptage tombe juste : ${D.fcfa(compte)}.`
          : e > 0
            ? `Il y a ${D.fcfa(e)} de plus que prévu dans le tiroir.`
            : `Il manque ${D.fcfa(-e)} dans le tiroir.`,
      detail:
        "L'écart est enregistré tel quel. Il ne sera pas corrigé : c'est ce qui permet de distinguer une erreur de rendu d'une perte.",
      confirmLabel: "Fermer la caisse",
      danger: e !== 0,
    });
    if (!ok) return;

    setOccupe(true);
    try {
      await api.records.update(manifest.slug, "sessions", active.id, {
        ...active.data,
        fermeeLe: new Date().toISOString(),
        comptage,
        compte,
        attendu,
        ecart: e,
      });
      await etat.rafraichir();
      setComptage({});
      setEcran("vente");
      notifier({
        titre: "Caisse fermée",
        message:
          e === 0 ? "Le comptage tombe juste." : `Écart de ${D.fcfa(e)} constaté.`,
        app: "Caisse",
        ton: e === 0 ? "success" : "warning",
      });
    } catch (err) {
      modal.alert({ title: "Fermeture impossible", message: err.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // ---- Ticket -------------------------------------------------------------

  const ajouterProduit = (p) => {
    setTicket((t) => ({
      ...t,
      lignes: D.ajouter(t.lignes, { id: p.id, ...p.data }),
    }));
    setRecherche("");
    champRecherche.current?.focus();
  };

  const changerQte = (i, q) =>
    setTicket((t) => ({ ...t, lignes: D.changerQuantite(t.lignes, i, q) }));

  const viderTicket = async () => {
    if (!ticket.lignes.length) return;
    const ok = await modal.confirm({
      title: "Annuler ce ticket ?",
      message: `${ticket.lignes.length} ligne(s) seront retirées.`,
      confirmLabel: "Annuler le ticket",
      danger: true,
    });
    if (!ok) return;
    setTicket(TICKET_VIDE());
    setPaiements([]);
  };

  // ---- Encaissement -------------------------------------------------------

  const encaisser = async () => {
    if (!s.solde) return;
    setOccupe(true);
    const numero = D.prochainNumero(tickets);
    try {
      const donnees = {
        numero,
        sessionId: active.id,
        date: ticket.date,
        lignes: ticket.lignes,
        paiements,
        ttc: Math.round(t.ttc),
        ht: Math.round(t.ht),
        tva: Math.round(t.tva),
        articles: t.articles,
        rendu: s.rendu,
      };
      await api.records.create(manifest.slug, "tickets", donnees);

      // Le stock baisse tout seul : c'est ce qui distingue une caisse
      // branchée d'un tiroir-caisse. Un échec ici ne doit pas annuler la
      // vente — elle a eu lieu — mais il doit se voir.
      const manques = [];
      for (const m of D.mouvementsDuTicket(donnees, numero)) {
        try {
          await api.records.create("stock", "mouvements", m);
        } catch {
          manques.push(m.articleId);
        }
      }
      if (manques.length) {
        modal.alert({
          title: "Vente enregistrée, stock non mis à jour",
          message: `${manques.length} article(s) n'ont pas pu être décrémentés.`,
          detail:
            "La vente est bien enregistrée. Corrigez le stock par un inventaire dans l'application Stock.",
          tone: "warning",
        });
      } else {
        invaliderReferentiel();
      }

      setTicket(TICKET_VIDE());
      setPaiements([]);
      setEcran("vente");
      await etat.rafraichir();
      champRecherche.current?.focus();
    } catch (e) {
      modal.alert({ title: "Encaissement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  // Le champ de recherche reprend la main dès que la fenêtre s'ouvre : au
  // comptoir, on tape, on ne cherche pas où cliquer.
  useEffect(() => {
    if (ouvert && ecran === "vente") {
      setTimeout(() => champRecherche.current?.focus(), 150);
    }
  }, [ouvert, ecran]);

  // ---- Rendu --------------------------------------------------------------

  if (!ouvert) {
    return (
      <ModuleWindow manifest={manifest} className="csApp">
        <div className="csVerrou">Connectez-vous pour ouvrir la caisse.</div>
      </ModuleWindow>
    );
  }

  return (
    <ModuleWindow manifest={manifest} className="csApp">
      <Contenu etat={etat} vide={false} lignes={6}>
        {!active ? (
          <Fermee
            sessions={sessions}
            tickets={tickets}
            occupe={occupe}
            onOuvrir={ouvrirSession}
          />
        ) : ecran === "fermeture" ? (
          <Fermeture
            session={active}
            tickets={tickets}
            comptage={comptage}
            setComptage={setComptage}
            occupe={occupe}
            onFermer={fermerSession}
            onRetour={() => setEcran("vente")}
          />
        ) : (
          <div className="csShell">
            <div className="csGauche">
              <BarreSession
                session={active}
                tickets={tickets}
                onFermer={() => setEcran("fermeture")}
              />
              <div className="csRecherche">
                <Icon fafa="faMagnifyingGlass" width={13} />
                <input
                  ref={champRecherche}
                  value={recherche}
                  placeholder="Chercher un produit, une référence, un code-barres…"
                  onChange={(e) => setRecherche(e.target.value)}
                  onKeyDown={(e) => {
                    // Un lecteur de code-barres tape puis valide : le
                    // premier résultat entre au ticket sans un clic.
                    if (e.key === "Enter" && produits.length) {
                      ajouterProduit(produits[0]);
                    }
                  }}
                />
              </div>
              <Categories
                categories={catalogue.categories}
                actif={categorie}
                onChoisir={setCategorie}
              />
              <Grille
                produits={produits}
                stocks={catalogue.stocks}
                onChoisir={ajouterProduit}
              />
            </div>

            <div className="csDroite">
              {ecran === "paiement" ? (
                <Paiement
                  ticket={ticket}
                  totaux={t}
                  solde={s}
                  paiements={paiements}
                  setPaiements={setPaiements}
                  occupe={occupe}
                  onEncaisser={encaisser}
                  onRetour={() => setEcran("vente")}
                />
              ) : (
                <Ticket
                  ticket={ticket}
                  totaux={t}
                  onQuantite={changerQte}
                  onVider={viderTicket}
                  onPayer={() => setEcran("paiement")}
                />
              )}
            </div>
          </div>
        )}
      </Contenu>
    </ModuleWindow>
  );
}

// ---------------------------------------------------------------------------
// Caisse fermée
// ---------------------------------------------------------------------------

const Fermee = ({ sessions, tickets, occupe, onOuvrir }) => {
  const passees = [...sessions]
    .filter((s) => s.data.fermeeLe)
    .sort((a, b) => String(b.data.date).localeCompare(String(a.data.date)))
    .slice(0, 8);

  return (
    <div className="csAccueil">
      <Icon className="csAccueilIcone" src="caisse" width={54} />
      <div className="csAccueilTitre">La caisse est fermée</div>
      <p>
        Ouvrez-la en indiquant ce que contient le tiroir. C'est à partir de ce
        montant que l'écart sera calculé à la fermeture.
      </p>
      <Bouton icone="faCashRegister" off={occupe} onClick={onOuvrir}>
        Ouvrir la caisse
      </Bouton>

      {passees.length ? (
        <div className="csHistorique">
          <h3>Dernières sessions</h3>
          <table className="csTable">
            <thead>
              <tr>
                <th>Date</th>
                <th className="csMt">Tickets</th>
                <th className="csMt">Recette</th>
                <th className="csMt">Écart</th>
              </tr>
            </thead>
            <tbody>
              {passees.map((s) => {
                const r = D.resume(s, tickets);
                const e = Number(s.data.ecart) || 0;
                return (
                  <tr key={s.id}>
                    <td>{s.data.date}</td>
                    <td className="csMt">{r.tickets}</td>
                    <td className="csMt">{D.fcfa(r.ca)}</td>
                    <td className="csMt" data-ecart={e === 0 ? "nul" : e > 0 ? "plus" : "moins"}>
                      {e === 0 ? "juste" : D.fcfa(e)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Vente
// ---------------------------------------------------------------------------

const BarreSession = ({ session, tickets, onFermer }) => {
  const r = D.resume(session, tickets);
  return (
    <div className="csBarre">
      <span className="csPastilleOuvert">
        <Icon fafa="faCashRegister" width={12} />
        Caisse ouverte
      </span>
      <span className="csStat">
        <b>{r.tickets}</b> ticket(s)
      </span>
      <span className="csStat">
        <b>{D.fcfa(r.ca)}</b> encaissés
      </span>
      <Bouton variante="secondaire" icone="faLock" onClick={onFermer}>
        Fermer la caisse
      </Bouton>
    </div>
  );
};

const Categories = ({ categories, actif, onChoisir }) => {
  const racines = (categories || []).filter((c) => !c.data.parentId);
  if (!racines.length) return null;
  return (
    <div className="csCategories">
      <div
        className="csCategorie handcr"
        data-actif={!actif}
        onClick={() => onChoisir("")}
      >
        Tout
      </div>
      {racines.map((c) => (
        <div
          key={c.id}
          className="csCategorie handcr"
          data-actif={actif === c.id}
          onClick={() => onChoisir(c.id)}
        >
          {c.data.nom}
        </div>
      ))}
    </div>
  );
};

/// Grille tactile. Les vignettes sont grandes à dessein : au comptoir on
/// vise vite, souvent d'un doigt, parfois sans regarder l'écran.
const Grille = ({ produits, stocks, onChoisir }) =>
  produits.length ? (
    <div className="csGrille cosScroll">
      {produits.map((p) => {
        const stock = stocks[p.id] ?? 0;
        return (
          <div
            key={p.id}
            className="csProduit handcr"
            data-rupture={stock <= 0}
            onClick={() => onChoisir(p)}
            title={p.data.designation}
          >
            <div className="csProduitImage">
              {p.data.vignette ? (
                <img src={p.data.vignette} alt="" />
              ) : (
                <Icon fafa="faBox" width={20} />
              )}
              {/* Le stock reste visible sans jamais bloquer la vente : un
                  commerçant sait mieux que le logiciel ce qu'il a en
                  rayon, et refuser une vente ferait perdre un client. */}
              {stock <= 0 ? <span className="csRupture">rupture</span> : null}
            </div>
            <div className="csProduitNom">{p.data.designation}</div>
            <div className="csProduitPrix">{D.fcfa(p.data.prixVente)}</div>
          </div>
        );
      })}
    </div>
  ) : (
    <Vide
      icone="faBoxOpen"
      titre="Aucun produit ne correspond"
      aide="Le catalogue vient de l'application Stock."
    />
  );

const Ticket = ({ ticket, totaux, onQuantite, onVider, onPayer }) => (
  <>
    <div className="csTicketTete">
      <h3>Ticket</h3>
      {ticket.lignes.length ? (
        <span className="csVider handcr" title="Annuler le ticket" onClick={onVider}>
          <Icon fafa="faTrashCan" width={12} />
        </span>
      ) : null}
    </div>

    <div className="csLignes cosScroll">
      {ticket.lignes.length ? (
        ticket.lignes.map((l, i) => (
          <div key={i} className="csLigne">
            <div className="csLigneNom">{l.designation}</div>
            <div className="csLigneQte">
              <span className="handcr" onClick={() => onQuantite(i, l.qte - 1)}>
                −
              </span>
              <b>{l.qte}</b>
              <span className="handcr" onClick={() => onQuantite(i, l.qte + 1)}>
                +
              </span>
            </div>
            <div className="csLigneTotal">{D.fcfa(D.totalLigne(l))}</div>
          </div>
        ))
      ) : (
        <div className="csTicketVide">
          Touchez un produit pour l'ajouter au ticket.
        </div>
      )}
    </div>

    <div className="csTotaux">
      <div className="csTotalLigne">
        <span>{totaux.articles} article(s)</span>
      </div>
      {totaux.parTaux
        .filter((x) => x.taux)
        .map((x) => (
          <div key={x.taux} className="csTotalLigne csTotalPetit">
            <span>dont TVA {x.taux} %</span>
            <span>{D.fcfa(x.montant)}</span>
          </div>
        ))}
      <div className="csTotalGrand">
        <span>Total</span>
        <b>{D.fcfa(totaux.ttc)}</b>
      </div>
      <Bouton
        large
        icone="faCashRegister"
        off={!ticket.lignes.length}
        onClick={onPayer}
      >
        Encaisser
      </Bouton>
    </div>
  </>
);

// ---------------------------------------------------------------------------
// Paiement
// ---------------------------------------------------------------------------

const Paiement = ({
  totaux,
  solde,
  paiements,
  setPaiements,
  occupe,
  onEncaisser,
  onRetour,
}) => {
  const [moyen, setMoyen] = useState("especes");
  const [montant, setMontant] = useState("");

  const encaisserPartie = (valeur) => {
    const m = Number(valeur) || 0;
    if (m <= 0) return;
    setPaiements((p) => [...p, { moyen, montant: m }]);
    setMontant("");
  };

  return (
    <>
      <div className="csTicketTete">
        <span className="csRetour handcr" onClick={onRetour}>
          <Icon fafa="faArrowLeft" width={12} />
        </span>
        <h3>Encaissement</h3>
      </div>

      <div className="csPaiement cosScroll">
        <div className="csAPayer">
          <span>À payer</span>
          <b>{D.fcfa(solde.reste || totaux.ttc)}</b>
        </div>

        <div className="csMoyens">
          {D.MOYENS.map((m) => (
            <div
              key={m.id}
              className="csMoyen handcr"
              data-actif={moyen === m.id}
              onClick={() => setMoyen(m.id)}
            >
              <Icon fafa={m.icone} width={15} />
              <span>{m.label}</span>
            </div>
          ))}
        </div>

        {/* Les coupures que le client va tendre. C'est ce qui supprime la
            saisie dans la quasi-totalité des ventes en espèces. */}
        {D.MOYENS.find((m) => m.id === moyen)?.rendu ? (
          <div className="csCoupures">
            {D.suggestions(solde.reste || totaux.ttc).map((c) => (
              <div key={c} className="csCoupure handcr" onClick={() => encaisserPartie(c)}>
                {D.fcfa(c)}
              </div>
            ))}
          </div>
        ) : null}

        <div className="csSaisie">
          <input
            type="number"
            value={montant}
            placeholder="Autre montant"
            onChange={(e) => setMontant(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && encaisserPartie(montant)}
          />
          <Bouton variante="secondaire" onClick={() => encaisserPartie(montant)}>
            Ajouter
          </Bouton>
          <Bouton
            variante="secondaire"
            onClick={() => encaisserPartie(solde.reste || totaux.ttc)}
          >
            Compte juste
          </Bouton>
        </div>

        {paiements.length ? (
          <div className="csRecus">
            {paiements.map((p, i) => (
              <div key={i} className="csRecu">
                <span>{D.MOYENS.find((m) => m.id === p.moyen)?.label}</span>
                <b>{D.fcfa(p.montant)}</b>
                <span
                  className="handcr"
                  title="Retirer"
                  onClick={() => setPaiements((l) => l.filter((_, j) => j !== i))}
                >
                  <Icon fafa="faXmark" width={10} />
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Le rendu en très gros : c'est ce que le caissier lit de loin, la
          main dans le tiroir. */}
      {solde.rendu ? (
        <div className="csRendu">
          <span>À rendre</span>
          <b>{D.fcfa(solde.rendu)}</b>
          <em>{D.enCoupures(solde.rendu).map((c) => `${c.nombre} × ${c.coupure}`).join("  ·  ")}</em>
        </div>
      ) : null}

      {solde.rendu > solde.renduPossible ? (
        <Notice ton="attention">
          Le tiroir n'a reçu que {D.fcfa(solde.renduPossible)} en espèces : le
          reste du rendu devra sortir du fond de caisse.
        </Notice>
      ) : null}

      <div className="csTotaux">
        <Bouton
          large
          icone="faCheck"
          off={occupe || !solde.solde}
          onClick={onEncaisser}
        >
          {solde.solde ? "Valider la vente" : `Reste ${D.fcfa(solde.reste)}`}
        </Bouton>
      </div>
    </>
  );
};

// ---------------------------------------------------------------------------
// Fermeture
// ---------------------------------------------------------------------------

/// Le comptage se fait coupure par coupure — c'est ainsi qu'on compte une
/// caisse. Saisir un total de mémoire, c'est recopier le chiffre attendu
/// sans jamais ouvrir le tiroir.
const Fermeture = ({
  session,
  tickets,
  comptage,
  setComptage,
  occupe,
  onFermer,
  onRetour,
}) => {
  const r = D.resume(session, tickets);
  const attendu = D.attenduEnCaisse(session, tickets);
  const compte = D.totalComptage(comptage);
  const e = compte - attendu;

  return (
    <div className="csFermeture cosScroll">
      <div className="csTicketTete">
        <span className="csRetour handcr" onClick={onRetour}>
          <Icon fafa="faArrowLeft" width={12} />
        </span>
        <h3>Fermeture de caisse</h3>
      </div>

      <div className="csDeux">
        <div className="csBloc">
          <h4>La journée</h4>
          <table className="csTable">
            <tbody>
              <tr>
                <td>Fond d'ouverture</td>
                <td className="csMt">{D.fcfa(session.data.fond)}</td>
              </tr>
              <tr>
                <td>Tickets</td>
                <td className="csMt">{r.tickets}</td>
              </tr>
              <tr>
                <td>Recette</td>
                <td className="csMt">{D.fcfa(r.ca)}</td>
              </tr>
              <tr>
                <td>Panier moyen</td>
                <td className="csMt">{D.fcfa(r.panierMoyen)}</td>
              </tr>
              {r.encaissements.parMoyen
                .filter((m) => m.montant)
                .map((m) => (
                  <tr key={m.id}>
                    <td>{m.label}</td>
                    <td className="csMt">{D.fcfa(m.montant)}</td>
                  </tr>
                ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Le tiroir devrait contenir</td>
                <td className="csMt">{D.fcfa(attendu)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="csBloc">
          <h4>Comptez le tiroir</h4>
          <div className="csComptage">
            {D.COUPURES.map((c) => (
              <label key={c} className="csCoupureLigne">
                <span>{D.fcfa(c)}</span>
                <input
                  type="number"
                  min="0"
                  value={comptage[c] || ""}
                  placeholder="0"
                  onChange={(ev) =>
                    setComptage((x) => ({ ...x, [c]: Number(ev.target.value) || 0 }))
                  }
                />
                <b>{comptage[c] ? D.fcfa(c * comptage[c]) : ""}</b>
              </label>
            ))}
          </div>
          <div className="csTotalGrand">
            <span>Compté</span>
            <b>{D.fcfa(compte)}</b>
          </div>
        </div>
      </div>

      <div className="csEcart" data-ecart={e === 0 ? "nul" : e > 0 ? "plus" : "moins"}>
        <span>
          {e === 0
            ? "Le comptage tombe juste"
            : e > 0
              ? "Il y a plus que prévu dans le tiroir"
              : "Il manque de l'argent dans le tiroir"}
        </span>
        <b>{e === 0 ? D.fcfa(compte) : D.fcfa(e)}</b>
      </div>

      <div className="csActions">
        <Bouton icone="faLock" off={occupe} onClick={onFermer}>
          Fermer la caisse
        </Bouton>
        <Bouton variante="secondaire" onClick={onRetour}>
          Continuer à vendre
        </Bouton>
      </div>
    </div>
  );
};
