// Livraisons — la fiche d'une livraison (panneau latéral).
//
// En haut ce qu'on fait le plus : joindre le client (appel, WhatsApp,
// itinéraire). Puis où, quand, quoi, combien encaisser, la preuve de
// remise et l'historique. Les actions du pied changent avec le statut :
// on ne propose jamais un geste impossible.

import React from "react";
import { Icon } from "../../../utils/general";
import { suivreLien } from "../../notifications";
import * as L from "@companyos/shared/livraisons";
import { Panneau, SignatureVue, Statut, fcfa, heure, jourLisible, useLiv } from "./commun";

export const Fiche = ({ livraison: l, onFermer }) => {
  const c = useLiv();
  const d = l.data;
  const lv = c.livreur(d.livreurId);
  const tournee = d.tourneeId ? c.tournees.find((t) => t.id === d.tourneeId) : null;
  const ouvert = L.STATUTS[d.statut]?.ouvert;
  const message = (type) => L.messageClient(l, type, { entreprise: c.entreprise?.nom || "", livreur: lv?.nom || "", telLivreur: lv?.telephone || "", gabarits: c.reglages.gabarits });
  const typeMessage = d.statut === "en_route" ? "en_route" : d.statut === "livree" ? "livree" : d.statut === "echec" ? "echec" : "planifiee";
  const wa = L.lienWhatsApp(d.telephone, message(typeMessage));
  const totalColis = (d.colis || []).reduce((s, x) => s + (Number(x.qte) || 0), 0);

  const pied = (
    <>
      {ouvert ? (
        <>
          <button type="button" className="lvBouton" data-variante="ok" disabled={c.occupe} onClick={() => c.ouvrirFormulaire({ type: "preuve", livraisonId: l.id })}>
            <Icon fafa="faCircleCheck" width={12} /> Livrée
          </button>
          <button type="button" className="lvBouton" data-variante="danger-doux" disabled={c.occupe} onClick={() => c.ouvrirFormulaire({ type: "echec", livraisonId: l.id })}>
            <Icon fafa="faCircleXmark" width={12} /> Échec
          </button>
          {d.statut === "planifiee" ? (
            <button type="button" className="lvBouton" data-variante="secondaire" disabled={c.occupe} onClick={() => c.changerStatut(l, "en_route")}>
              <Icon fafa="faTruckFast" width={12} /> En route
            </button>
          ) : null}
        </>
      ) : null}
      {d.statut === "echec" || d.statut === "annulee" ? (
        <button type="button" className="lvBouton" disabled={c.occupe} onClick={() => c.changerStatut(l, "a_planifier", { date: d.date < L.aujourdhui() ? L.aujourdhui() : d.date, note: "Reprogrammée" })}>
          <Icon fafa="faRotateRight" width={12} /> Reprogrammer
        </button>
      ) : null}
      <span className="lvEspace" />
      {ouvert ? (
        <button type="button" className="lvIconeBtn" title="Modifier" aria-label="Modifier" onClick={() => c.ouvrirFormulaire({ type: "livraison", livraison: l })}>
          <Icon fafa="faPen" width={12} />
        </button>
      ) : null}
      {ouvert ? (
        <button type="button" className="lvIconeBtn" title="Annuler la livraison" aria-label="Annuler la livraison" onClick={() => c.changerStatut(l, "annulee", { note: "Annulée" })}>
          <Icon fafa="faBan" width={12} />
        </button>
      ) : null}
      {d.statut !== "livree" ? (
        <button type="button" className="lvIconeBtn" title="Supprimer" aria-label="Supprimer" onClick={() => c.supprimerLivraison(l)}>
          <Icon fafa="faTrashCan" width={12} />
        </button>
      ) : null}
    </>
  );

  return (
    <Panneau titre={d.clientNom || d.contact || "Livraison"} sousTitre={<><span className="lvMono">{d.numero}</span> · <Statut statut={d.statut} petit /></>} onFermer={onFermer} pied={pied}>
      {/* Joindre le client */}
      <div className="lvJoindre">
        <a className="lvJoindreBtn" href={d.telephone ? `tel:${d.telephone.replace(/\s/g, "")}` : undefined} data-off={!d.telephone || undefined}>
          <Icon fafa="faPhone" width={14} />
          <span>Appeler</span>
        </a>
        <a className="lvJoindreBtn" data-whatsapp href={wa || undefined} target="_blank" rel="noopener noreferrer" data-off={!wa || undefined}>
          <Icon fafa="faCommentDots" width={14} />
          <span>WhatsApp</span>
        </a>
        <a className="lvJoindreBtn" href={L.lienItineraire(d)} target="_blank" rel="noopener noreferrer">
          <Icon fafa="faDiamondTurnRight" width={14} />
          <span>Itinéraire</span>
        </a>
      </div>

      <dl className="lvInfos">
        <div>
          <dt><Icon fafa="faUser" width={11} /> Contact</dt>
          <dd>{d.contact || "—"}<small>{d.telephone || "Téléphone manquant"}</small></dd>
        </div>
        <div>
          <dt><Icon fafa="faLocationDot" width={11} /> Adresse</dt>
          <dd>
            {[d.commune, d.adresse].filter(Boolean).join(", ") || "—"}
            {d.repere ? <small>Repère : {d.repere}</small> : null}
            {d.gps ? <small className="lvMono">{Number(d.gps.lat).toFixed(5)}, {Number(d.gps.lng).toFixed(5)}</small> : null}
          </dd>
        </div>
        <div>
          <dt><Icon fafa="faCalendarDay" width={11} /> Quand</dt>
          <dd>{jourLisible(d.date)}<small>{d.creneau ? `Entre ${d.creneau.debut} et ${d.creneau.fin}` : "Dans la journée"}{d.priorite === "urgente" ? " · urgente" : ""}</small></dd>
        </div>
        <div>
          <dt><Icon fafa="faRoute" width={11} /> Tournée</dt>
          <dd>{tournee ? <>{lv?.nom || "—"}<small>{tournee.data.numero} · arrêt n° {d.ordre || "—"}</small></> : <span className="lvDiscret">Pas encore planifiée</span>}</dd>
        </div>
      </dl>

      {d.instructions ? <div className="lvConsigne"><Icon fafa="faCircleInfo" width={11} /> {d.instructions}</div> : null}

      <section className="lvBloc">
        <h3>Colis <span>{totalColis} article{totalColis > 1 ? "s" : ""}</span></h3>
        {d.colis?.length ? (
          <ul className="lvColis">
            {d.colis.map((x, i) => (
              <li key={i}><span>{x.designation}</span><b>× {x.qte}</b></li>
            ))}
          </ul>
        ) : <p className="lvDiscret">Aucun détail de colis.</p>}
        {d.factureId ? (
          <button type="button" className="lvLienFiche" onClick={() => suivreLien({ lien: { app: "facturation", params: { facture: d.factureId } } })}>
            <Icon fafa="faFileInvoice" width={11} /> Facture {d.factureNumero || ""} <Icon fafa="faArrowUpRightFromSquare" width={9} />
          </button>
        ) : null}
        {d.clientId ? (
          <button type="button" className="lvLienFiche" onClick={() => suivreLien({ lien: { app: "crm", params: { client: d.clientId } } })}>
            <Icon fafa="faUserTie" width={11} /> Fiche client <Icon fafa="faArrowUpRightFromSquare" width={9} />
          </button>
        ) : null}
      </section>

      <section className="lvBloc">
        <h3>Encaissement</h3>
        {d.encaissement?.montant ? (
          <div className="lvEncaisse" data-ok>
            <Icon fafa="faCircleCheck" width={14} />
            <div>
              <b>{fcfa(d.encaissement.montant)} encaissés</b>
              <small>{L.moyenDe(d.encaissement.moyen).label}{d.encaissement.reference ? ` · réf. ${d.encaissement.reference}` : ""}{d.encaissement.le ? ` · ${heure(d.encaissement.le)}` : ""}</small>
            </div>
          </div>
        ) : Number(d.montantAEncaisser) > 0 ? (
          <div className="lvEncaisse">
            <Icon fafa="faCoins" width={14} />
            <div>
              <b>{fcfa(d.montantAEncaisser)} à encaisser</b>
              <small>Au moment de la remise — espèces ou mobile money</small>
            </div>
          </div>
        ) : <p className="lvDiscret">Rien à encaisser : la commande est déjà réglée.</p>}
      </section>

      {d.statut === "livree" && d.preuve ? (
        <section className="lvBloc">
          <h3>Preuve de livraison</h3>
          <div className="lvPreuve">
            <div>
              <small>Remis à</small>
              <b>{d.preuve.recuPar || "—"}</b>
              <small>{d.preuve.le ? `${jourLisible(d.preuve.le.slice(0, 10))} à ${heure(d.preuve.le)}` : ""}</small>
            </div>
            <SignatureVue signature={d.preuve.signature} />
          </div>
          {d.preuve.photo ? (
            <button type="button" className="lvLienFiche" onClick={() => suivreLien({ lien: { app: "explorer", params: { noeud: d.preuve.photo.id } } })}>
              <Icon fafa="faCamera" width={11} /> Photo : {d.preuve.photo.name}
            </button>
          ) : null}
        </section>
      ) : null}

      {d.statut === "echec" && d.echec ? (
        <section className="lvBloc">
          <h3>Échec</h3>
          <div className="lvEchec"><Icon fafa="faTriangleExclamation" width={12} /> {L.MOTIFS_ECHEC.find((m) => m.id === d.echec.motif)?.label || "Échec"}{d.echec.note ? ` — ${d.echec.note}` : ""}</div>
        </section>
      ) : null}

      <section className="lvBloc">
        <h3>Historique</h3>
        <ol className="lvHistorique">
          {[...(d.historique || [])].reverse().map((h, i) => (
            <li key={i} data-statut={h.statut}>
              <i />
              <div>
                <b>{L.STATUTS[h.statut]?.label || h.statut}</b>
                <small>{h.le ? `${jourLisible(h.le.slice(0, 10))} à ${heure(h.le)}` : ""}{h.par ? ` · ${h.par}` : ""}</small>
                {h.note ? <span>{h.note}</span> : null}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Panneau>
  );
};
