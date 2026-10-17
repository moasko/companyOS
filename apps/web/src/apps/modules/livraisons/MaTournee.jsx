// Livraisons — « Ma tournée » : l'écran du livreur, pensé pour le
// téléphone tenu d'une main, au soleil, sur une moto à l'arrêt.
//
// Un seul arrêt en grand — le prochain — avec quatre gestes : appeler,
// WhatsApp, itinéraire, et « Livré » / « Échec ». Le reste de la tournée
// se replie dessous. Gros boutons, gros textes, contraste fort.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import * as L from "@companyos/shared/livraisons";
import { Avancement, Avatar, IconeVehicule, Statut, fcfa, heure, jourLisible, useLiv } from "./commun";

export const MaTournee = () => {
  const c = useLiv();
  const jour = L.aujourdhui();
  // Le gérant peut regarder l'écran d'un livreur : utile pour l'aider au
  // téléphone, ou pour saisir à sa place.
  const [choix, setChoix] = useState("");
  const livreurId = choix || (c.moi && c.livreurs.some((x) => x.id === c.moi.id) ? c.moi.id : "") || (c.admin ? c.tournees.find((t) => t.data.date === jour)?.data.livreurId || "" : "");
  const lv = c.livreur(livreurId);
  const tournee = useMemo(
    () => c.tournees.filter((t) => t.data.date === jour && t.data.livreurId === livreurId).sort((a, b) => Number(a.data.statut === "terminee") - Number(b.data.statut === "terminee"))[0] || null,
    [c.tournees, jour, livreurId],
  );
  const arrets = tournee ? c.arretsDe(tournee.id) : [];
  const prochain = arrets.find((l) => L.STATUTS[l.data.statut]?.ouvert) || null;
  const av = L.avancementTournee(arrets);
  const encaisse = arrets.reduce((s, l) => s + (Number(l.data.encaissement?.montant) || 0), 0);
  const parMoyen = arrets.reduce((m, l) => {
    const e = l.data.encaissement;
    if (e?.montant) m[e.moyen] = (m[e.moyen] || 0) + Number(e.montant);
    return m;
  }, {});
  const ve = tournee ? c.vehicule(tournee.data.vehiculeId) : null;

  const selecteur = c.admin ? (
    <div className="lvApercu">
      <Icon fafa="faEye" width={11} />
      <span>Aperçu de l'écran livreur :</span>
      <select value={livreurId} onChange={(e) => setChoix(e.target.value)} aria-label="Livreur">
        <option value="">Choisir un livreur</option>
        {c.livreurs.map((x) => <option key={x.id} value={x.id}>{x.nom}{c.tournees.some((t) => t.data.date === jour && t.data.livreurId === x.id) ? "" : " (pas de tournée)"}</option>)}
      </select>
    </div>
  ) : null;

  if (!tournee) {
    return (
      <div className="lvVue lvLivreur">
        {selecteur}
        <div className="lvVide">
          <Icon fafa="faMugHot" width={30} />
          <b>{lv ? `Pas de tournée aujourd'hui, ${lv.nom.split(" ")[0]}` : "Aucune tournée à afficher"}</b>
          <span>{lv ? "Votre répartiteur vous confiera vos livraisons ici. Elles apparaîtront dans l'ordre de passage." : c.admin ? "Choisissez un livreur pour voir sa tournée du jour comme lui la voit." : "Votre compte n'est relié à aucune fiche salarié : demandez à l'administrateur d'indiquer votre e-mail dans les RH."}</span>
        </div>
      </div>
    );
  }

  const statut = tournee.data.statut || "planifiee";
  return (
    <div className="lvVue lvLivreur">
      {selecteur}

      <header className="lvLivreurTete">
        <Avatar nom={lv?.nom || "?"} taille={40} />
        <div>
          <b>{lv?.nom}</b>
          <small>{jourLisible(jour)} · <span className="lvMono">{tournee.data.numero}</span>{ve ? <> · <IconeVehicule type={ve.data.type} taille={10} /> {ve.data.nom}</> : null}</small>
        </div>
        <div className="lvLivreurCompte">
          <b>{av.fait}<span>/{av.total}</span></b>
          <small>arrêts</small>
        </div>
      </header>
      <Avancement pct={av.pct} ton={statut === "terminee" ? "ok" : "info"} />

      {statut === "planifiee" ? (
        <button type="button" className="lvGrosBouton" data-variante="principal" disabled={c.occupe || !arrets.length} onClick={() => c.demarrer(tournee)}>
          <Icon fafa="faPlay" width={16} />
          <span>Démarrer la tournée<small>{arrets.length} arrêt{arrets.length > 1 ? "s" : ""} · les clients sont prévenus d'un geste</small></span>
        </button>
      ) : null}

      {prochain ? (
        <Prochain l={prochain} numero={arrets.indexOf(prochain) + 1} total={arrets.length} lv={lv} actif={statut === "en_cours"} />
      ) : (
        <section className="lvFini">
          <Icon fafa="faFlagCheckered" width={28} />
          <b>Tournée terminée, bravo !</b>
          <span>{av.fait} arrêt{av.fait > 1 ? "s" : ""} · {fcfa(encaisse)} encaissés. Rapportez la caisse au dépôt.</span>
          {Object.keys(parMoyen).length ? (
            <ul className="lvCaisse">
              {Object.entries(parMoyen).map(([m, v]) => (
                <li key={m}><i style={{ background: L.moyenDe(m).couleur || "#16a34a" }} />{L.moyenDe(m).label}<b>{fcfa(v)}</b></li>
              ))}
            </ul>
          ) : null}
          {statut !== "terminee" ? (
            <button type="button" className="lvGrosBouton" data-variante="ok" disabled={c.occupe} onClick={() => c.terminer(tournee)}>
              <Icon fafa="faCircleCheck" width={16} /><span>Clôturer la tournée</span>
            </button>
          ) : null}
        </section>
      )}

      <section className="lvLivreurListe">
        <h3>Tous les arrêts <span>{fcfa(encaisse)} encaissés</span></h3>
        <ol>
          {arrets.map((l, i) => (
            <li key={l.id} data-statut={l.data.statut} data-prochain={l === prochain || undefined}>
              <button type="button" onClick={() => c.ouvrirFiche(l.id)}>
                <span className="lvNumero">{i + 1}</span>
                <span className="lvLivreurArret">
                  <b>{l.data.clientNom || l.data.contact}</b>
                  <small>{l.data.commune}{l.data.repere ? ` · ${l.data.repere}` : ""}</small>
                </span>
                {L.STATUTS[l.data.statut]?.ouvert ? (
                  Number(l.data.montantAEncaisser) > 0 ? <span className="lvCod">{fcfa(l.data.montantAEncaisser)}</span> : null
                ) : (
                  <Statut statut={l.data.statut} petit />
                )}
              </button>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
};

/// Le prochain arrêt, en grand.
const Prochain = ({ l, numero, total, lv, actif }) => {
  const c = useLiv();
  const d = l.data;
  const message = L.messageClient(l, "en_route", { entreprise: c.entreprise?.nom || "", livreur: lv?.nom || "", telLivreur: lv?.telephone || "", gabarits: c.reglages.gabarits });
  const wa = L.lienWhatsApp(d.telephone, message);
  const tel = d.telephone ? `tel:${d.telephone.replace(/\s/g, "")}` : null;
  const retard = L.enRetard(d);
  return (
    <section className="lvProchain" aria-label="Prochain arrêt">
      <div className="lvProchainTete">
        <span>Arrêt {numero} sur {total}</span>
        {d.creneau ? <span className="lvBadge" data-ton={retard ? "danger" : "info"}><Icon fafa="faClock" width={9} /> {d.creneau.debut}–{d.creneau.fin}{retard ? " · en retard" : ""}</span> : null}
        {d.priorite === "urgente" ? <span className="lvBadge" data-ton="danger">Urgent</span> : null}
      </div>
      <h2>{d.clientNom || d.contact}</h2>
      <div className="lvProchainAdresse">
        <Icon fafa="faLocationDot" width={13} />
        <span>
          <b>{[d.commune, d.adresse].filter(Boolean).join(", ") || "Adresse à préciser"}</b>
          {d.repere ? <small>{d.repere}</small> : null}
        </span>
      </div>
      {d.instructions ? <div className="lvConsigne"><Icon fafa="faCircleInfo" width={11} /> {d.instructions}</div> : null}

      <div className="lvProchainInfos">
        <div>
          <small>Contact</small>
          <b>{d.contact || "—"}</b>
          <span className="lvMono">{d.telephone || "pas de numéro"}</span>
        </div>
        <div>
          <small>Colis</small>
          <b>{(d.colis || []).reduce((s, x) => s + (Number(x.qte) || 0), 0) || "—"}</b>
          <span>{(d.colis || []).slice(0, 2).map((x) => x.designation).join(", ")}{d.colis?.length > 2 ? "…" : ""}</span>
        </div>
        <div data-cod={Number(d.montantAEncaisser) > 0 || undefined}>
          <small>À encaisser</small>
          <b>{Number(d.montantAEncaisser) > 0 ? fcfa(d.montantAEncaisser) : "Rien"}</b>
          <span>{Number(d.montantAEncaisser) > 0 ? "espèces ou mobile money" : "déjà payée"}</span>
        </div>
      </div>

      <div className="lvGestes">
        <a href={tel || undefined} data-off={!tel || undefined}><Icon fafa="faPhone" width={18} /><span>Appeler</span></a>
        <a href={wa || undefined} target="_blank" rel="noopener noreferrer" data-whatsapp data-off={!wa || undefined}><Icon fafa="faCommentDots" width={18} /><span>WhatsApp</span></a>
        <a href={L.lienItineraire(d)} target="_blank" rel="noopener noreferrer"><Icon fafa="faDiamondTurnRight" width={18} /><span>Itinéraire</span></a>
      </div>

      <div className="lvIssue">
        <button type="button" className="lvGrosBouton" data-variante="danger" disabled={c.occupe} onClick={() => c.ouvrirFormulaire({ type: "echec", livraisonId: l.id })}>
          <Icon fafa="faCircleXmark" width={16} /><span>Échec</span>
        </button>
        <button type="button" className="lvGrosBouton" data-variante="ok" disabled={c.occupe} onClick={() => (actif || d.statut === "en_route" ? c.ouvrirFormulaire({ type: "preuve", livraisonId: l.id }) : c.changerStatut(l, "en_route"))}>
          <Icon fafa={actif || d.statut === "en_route" ? "faCircleCheck" : "faTruckFast"} width={16} />
          <span>{actif || d.statut === "en_route" ? "Livré" : "Je pars"}</span>
        </button>
      </div>
      {d.historique?.length ? <p className="lvDiscret lvProchainPied">Dernière mise à jour à {heure(d.historique[d.historique.length - 1].le)}</p> : null}
    </section>
  );
};
