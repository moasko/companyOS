// Livraisons — « Aujourd'hui » : la répartition du jour.
//
// À gauche ce qui reste à planifier, à droite une colonne par tournée.
// On glisse une livraison sur une tournée (ou on coche puis « Affecter à »,
// pour le tactile et le clavier). Chaque tournée dit son avancement, sa
// distance et sa durée estimées, et se démarre d'un bouton.

import React, { useMemo, useState } from "react";
import { Icon } from "../../../utils/general";
import * as L from "@companyos/shared/livraisons";
import { Avancement, Avatar, IconeVehicule, Kpi, Statut, decalerJour, fcfa, jourLisible, useLiv } from "./commun";
import { imprimerFeuille } from "./Tournees";

export const Dispatch = () => {
  const c = useLiv();
  const { jour, setJour, livraisons, tournees, telephone } = c;
  const [commune, setCommune] = useState("");
  const [coches, setCoches] = useState(() => new Set());
  const [survol, setSurvol] = useState(null);
  const [onglet, setOnglet] = useState("planifier");

  const k = useMemo(() => L.indicateurs(livraisons.map((l) => l.data), jour), [livraisons, jour]);
  // À planifier : celles du jour, et les retards des jours passés.
  const aPlanifier = useMemo(
    () =>
      livraisons
        .filter((l) => l.data.statut === "a_planifier" && l.data.date <= jour && (l.data.date === jour || jour === L.aujourdhui()))
        .filter((l) => !commune || l.data.commune === commune)
        .sort((a, b) => Number(b.data.priorite === "urgente") - Number(a.data.priorite === "urgente") || (a.data.commune || "").localeCompare(b.data.commune || "", "fr")),
    [livraisons, jour, commune],
  );
  const communes = useMemo(() => [...new Set(livraisons.filter((l) => l.data.statut === "a_planifier").map((l) => l.data.commune).filter(Boolean))].sort(), [livraisons]);
  const duJour = useMemo(() => tournees.filter((t) => t.data.date === jour).sort((a, b) => (a.data.numero || "").localeCompare(b.data.numero || "")), [tournees, jour]);

  const basculer = (id) =>
    setCoches((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const affecterCoches = async (t) => {
    await c.affecter([...coches], t);
    setCoches(new Set());
  };

  const sansLivreurs = !c.livreurs.length;

  return (
    <div className="lvVue lvDispatch">
      {!telephone ? (
        <header className="lvEntete">
          <div>
            <h1>Répartition du jour</h1>
            <p>{jourLisible(jour) === "Aujourd'hui" ? "Planifiez, suivez et clôturez les tournées d'aujourd'hui." : jourLisible(jour)}</p>
          </div>
          <div className="lvEnteteActions">
            <div className="lvJour" role="group" aria-label="Jour affiché">
              <button type="button" aria-label="Jour précédent" onClick={() => setJour(decalerJour(jour, -1))}><Icon fafa="faChevronLeft" width={11} /></button>
              <input type="date" value={jour} onChange={(e) => e.target.value && setJour(e.target.value)} aria-label="Choisir le jour" />
              <button type="button" aria-label="Jour suivant" onClick={() => setJour(decalerJour(jour, 1))}><Icon fafa="faChevronRight" width={11} /></button>
              {jour !== L.aujourdhui() ? <button type="button" className="lvJourAuj" onClick={() => setJour(L.aujourdhui())}>Aujourd'hui</button> : null}
            </div>
            <button type="button" className="lvBouton" data-variante="secondaire" onClick={() => c.ouvrirFormulaire({ type: "tournee", date: jour })}>
              <Icon fafa="faRoute" width={12} /> Nouvelle tournée
            </button>
          </div>
        </header>
      ) : null}

      <div className="lvKpis">
        <Kpi icone="faInbox" ton="neutre" libelle="À planifier" valeur={k.aPlanifier} detail={k.enRetard ? `${k.enRetard} en retard` : "aucun retard"} />
        <Kpi icone="faTruckFast" ton="attention" libelle="En route" valeur={k.enRoute} detail={`${k.planifiees} planifiée${k.planifiees > 1 ? "s" : ""}`} />
        <Kpi icone="faCircleCheck" ton="ok" libelle="Livrées" valeur={`${k.livrees}/${k.total}`} detail={k.tauxReussite == null ? "—" : `${k.tauxReussite} % de réussite`} />
        <Kpi icone="faCircleXmark" ton="danger" libelle="Échecs" valeur={k.echecs} detail={k.echecs ? "à reprogrammer" : "aucun"} />
        <Kpi icone="faCoins" ton="info" libelle="Encaissé" valeur={fcfa(k.encaisse)} detail={`${fcfa(k.aEncaisser)} attendus`} />
      </div>

      {telephone ? (
        <div className="lvOnglets" role="tablist">
          <button type="button" role="tab" aria-selected={onglet === "planifier"} data-actif={onglet === "planifier" || undefined} onClick={() => setOnglet("planifier")}>
            À planifier <em>{aPlanifier.length}</em>
          </button>
          <button type="button" role="tab" aria-selected={onglet === "tournees"} data-actif={onglet === "tournees" || undefined} onClick={() => setOnglet("tournees")}>
            Tournées <em>{duJour.length}</em>
          </button>
        </div>
      ) : null}

      <div className="lvPlan">
        {/* ------------------------------------------------ À planifier */}
        {!telephone || onglet === "planifier" ? (
          <section className="lvColonne lvAPlanifier" aria-label="Livraisons à planifier">
            <div className="lvColonneTete">
              <div>
                <h2>À planifier</h2>
                <span>{aPlanifier.length} livraison{aPlanifier.length > 1 ? "s" : ""}</span>
              </div>
              <select value={commune} onChange={(e) => setCommune(e.target.value)} aria-label="Filtrer par commune">
                <option value="">Toutes communes</option>
                {communes.map((x) => <option key={x}>{x}</option>)}
              </select>
            </div>
            <div className="lvColonneCorps cosScroll">
              {aPlanifier.length ? (
                aPlanifier.map((l) => (
                  <CarteLivraison
                    key={l.id}
                    l={l}
                    coche={coches.has(l.id)}
                    onCocher={() => basculer(l.id)}
                    onOuvrir={() => c.ouvrirFiche(l.id)}
                    retard={l.data.date < jour}
                  />
                ))
              ) : (
                <div className="lvVideMini">
                  <Icon fafa="faCircleCheck" width={20} />
                  <b>Tout est planifié</b>
                  <span>Les nouvelles livraisons arriveront ici.</span>
                  <button type="button" className="lvLien" onClick={() => c.ouvrirFormulaire({ type: "livraison", date: jour })}>Créer une livraison</button>
                </div>
              )}
            </div>
            {coches.size ? (
              <div className="lvAffecter">
                <span>{coches.size} sélectionnée{coches.size > 1 ? "s" : ""}</span>
                {duJour.filter((t) => t.data.statut !== "terminee").length ? (
                  <select defaultValue="" onChange={(e) => { const t = duJour.find((x) => x.id === e.target.value); if (t) affecterCoches(t); e.target.value = ""; }} aria-label="Affecter à une tournée">
                    <option value="" disabled>Affecter à…</option>
                    {duJour.filter((t) => t.data.statut !== "terminee").map((t) => (
                      <option key={t.id} value={t.id}>{c.livreur(t.data.livreurId)?.nom || t.data.numero}</option>
                    ))}
                  </select>
                ) : (
                  <button type="button" className="lvBouton" onClick={() => c.ouvrirFormulaire({ type: "tournee", date: jour, livraisons: [...coches] })}>Créer une tournée</button>
                )}
                <button type="button" className="lvLien" onClick={() => setCoches(new Set())}>Annuler</button>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ------------------------------------------------ Tournées */}
        {!telephone || onglet === "tournees" ? (
          <section className="lvTournees cosScroll" aria-label="Tournées du jour">
            {duJour.map((t) => (
              <Couloir
                key={t.id}
                t={t}
                survol={survol === t.id}
                onSurvol={(oui) => setSurvol(oui ? t.id : null)}
                onDepot={(ids) => c.affecter(ids, t)}
              />
            ))}
            <div className="lvCouloirNouveau">
              {sansLivreurs ? (
                <>
                  <Icon fafa="faUserPlus" width={20} />
                  <b>Aucun livreur</b>
                  <span>Les livreurs sont les salariés des Ressources humaines. Ajoutez-y vos livreurs pour leur confier des tournées.</span>
                </>
              ) : (
                <>
                  <Icon fafa="faRoute" width={20} />
                  <b>{duJour.length ? "Ajouter une tournée" : "Aucune tournée ce jour"}</b>
                  <span>Une tournée = un livreur, un véhicule, et ses arrêts dans le bon ordre.</span>
                  <div className="lvLivreursRapides">
                    {c.livreurs
                      .filter((x) => !duJour.some((t) => t.data.livreurId === x.id))
                      .slice(0, 4)
                      .map((x) => (
                        <button key={x.id} type="button" onClick={() => c.ouvrirFormulaire({ type: "tournee", date: jour, livreurId: x.id })}>
                          <Avatar nom={x.nom} taille={22} /> {x.nom.split(" ")[0]}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
};

/// Une livraison dans la colonne « À planifier » : glissable.
export const CarteLivraison = ({ l, coche, onCocher, onOuvrir, retard }) => {
  const d = l.data;
  return (
    <article
      className="lvCarte"
      data-coche={coche || undefined}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/livraisons", JSON.stringify([l.id]));
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOuvrir}
    >
      <label className="lvCase" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={!!coche} onChange={onCocher} aria-label={`Sélectionner ${d.numero}`} />
      </label>
      <div className="lvCarteCorps">
        <div className="lvCarteHaut">
          <b>{d.clientNom || d.contact || "Client"}</b>
          {d.priorite === "urgente" ? <span className="lvBadge" data-ton="danger">Urgent</span> : null}
          {retard ? <span className="lvBadge" data-ton="attention">En retard</span> : null}
        </div>
        <div className="lvCarteLigne">
          <Icon fafa="faLocationDot" width={10} />
          <span>{[d.commune, d.repere || d.adresse].filter(Boolean).join(" · ") || "Adresse à préciser"}</span>
        </div>
        <div className="lvCarteBas">
          {d.creneau && !(d.creneau.debut === "08:00" && d.creneau.fin === "18:00") ? <span><Icon fafa="faClock" width={9} /> {d.creneau.debut}–{d.creneau.fin}</span> : null}
          {d.colis?.length ? <span><Icon fafa="faBox" width={9} /> {d.colis.reduce((s, x) => s + (Number(x.qte) || 0), 0)}</span> : null}
          {Number(d.montantAEncaisser) > 0 ? <span className="lvCod">{fcfa(d.montantAEncaisser)}</span> : null}
        </div>
      </div>
      <Icon fafa="faGripVertical" width={10} className="lvPoignee" />
    </article>
  );
};

/// Une tournée : son livreur, son véhicule, ses arrêts.
const Couloir = ({ t, survol, onSurvol, onDepot }) => {
  const c = useLiv();
  const arrets = c.arretsDe(t.id);
  const lv = c.livreur(t.data.livreurId);
  const ve = c.vehicule(t.data.vehiculeId);
  const av = L.avancementTournee(arrets);
  const est = L.estimerTournee(arrets.filter((l) => L.STATUTS[l.data.statut]?.ouvert), { depot: c.depotPos, vehicule: ve?.data.type });
  const encaisse = arrets.reduce((s, l) => s + (Number(l.data.encaissement?.montant) || 0), 0);
  const attendu = arrets.reduce((s, l) => s + (L.STATUTS[l.data.statut]?.ouvert ? Number(l.data.montantAEncaisser) || 0 : 0), 0);
  const statut = t.data.statut || "planifiee";
  const termine = statut === "terminee";

  return (
    <article
      className="lvCouloir"
      data-survol={survol || undefined}
      data-statut={statut}
      onDragOver={(e) => {
        if (termine) return;
        e.preventDefault();
        onSurvol(true);
      }}
      onDragLeave={() => onSurvol(false)}
      onDrop={(e) => {
        e.preventDefault();
        onSurvol(false);
        try {
          onDepot(JSON.parse(e.dataTransfer.getData("text/livraisons") || "[]"));
        } catch {
          /* dépôt d'autre chose : ignoré */
        }
      }}
    >
      <header className="lvCouloirTete">
        <Avatar nom={lv?.nom || "?"} taille={34} />
        <div>
          <b>{lv?.nom || "Livreur à choisir"}</b>
          <span>
            {ve ? <><IconeVehicule type={ve.data.type} taille={10} /> {ve.data.nom}</> : "Sans véhicule"} · <span className="lvMono">{t.data.numero}</span>
          </span>
        </div>
        <span className="lvEtatTournee" data-statut={statut}>{statut === "en_cours" ? "En cours" : termine ? "Terminée" : "Planifiée"}</span>
      </header>
      <div className="lvCouloirChiffres">
        <span><b>{av.fait}/{av.total}</b> arrêts</span>
        <span><b>{est.km}</b> km</span>
        <span><b>{L.dureeLisible(est.minutes)}</b></span>
        <span><b>{fcfa(encaisse)}</b>{attendu ? ` / ${fcfa(encaisse + attendu)}` : ""}</span>
      </div>
      <Avancement pct={av.pct} ton={termine ? "ok" : "info"} />
      <ol className="lvArrets cosScroll">
        {arrets.length ? (
          arrets.map((l, i) => (
            <li key={l.id} className="lvArret" data-statut={l.data.statut}>
              <span className="lvNumero">{i + 1}</span>
              <button type="button" className="lvArretCorps" onClick={() => c.ouvrirFiche(l.id)}>
                <b>{l.data.clientNom || l.data.contact}</b>
                <span>{l.data.commune || "—"}{l.data.creneau ? ` · ${l.data.creneau.debut}–${l.data.creneau.fin}` : ""}</span>
              </button>
              {l.data.statut === "livree" || l.data.statut === "echec" ? (
                <Statut statut={l.data.statut} petit />
              ) : !termine ? (
                <span className="lvArretActions">
                  <button type="button" className="lvIconeBtn" aria-label="Monter" disabled={i === 0} onClick={() => c.deplacer(t, l, -1)}><Icon fafa="faArrowUp" width={9} /></button>
                  <button type="button" className="lvIconeBtn" aria-label="Descendre" disabled={i === arrets.length - 1} onClick={() => c.deplacer(t, l, 1)}><Icon fafa="faArrowDown" width={9} /></button>
                  <button type="button" className="lvIconeBtn" aria-label="Retirer de la tournée" onClick={() => c.retirer(l)}><Icon fafa="faXmark" width={9} /></button>
                </span>
              ) : null}
            </li>
          ))
        ) : (
          <li className="lvDepose">
            <Icon fafa="faArrowsDownToLine" width={14} />
            Glissez des livraisons ici
          </li>
        )}
      </ol>
      <footer className="lvCouloirPied">
        {!termine ? (
          <>
            <button type="button" className="lvBouton" data-variante="secondaire" disabled={arrets.length < 2 || c.occupe} onClick={() => c.optimiser(t)} title="Recalculer l'ordre de passage le plus court">
              <Icon fafa="faWandMagicSparkles" width={11} /> Optimiser
            </button>
            {statut === "planifiee" ? (
              <button type="button" className="lvBouton" disabled={!arrets.length || c.occupe} onClick={() => c.demarrer(t)}>
                <Icon fafa="faPlay" width={10} /> Démarrer
              </button>
            ) : (
              <button type="button" className="lvBouton" data-variante="ok" disabled={c.occupe} onClick={() => c.terminer(t)}>
                <Icon fafa="faFlagCheckered" width={11} /> Clôturer
              </button>
            )}
          </>
        ) : (
          <span className="lvTermine"><Icon fafa="faCircleCheck" width={11} /> Clôturée {t.data.termineeLe ? `à ${new Date(t.data.termineeLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        )}
        <span className="lvEspace" />
        <button type="button" className="lvIconeBtn" aria-label="Imprimer la feuille de route" title="Feuille de route" disabled={!arrets.length} onClick={() => imprimerFeuille(t, arrets, c)}>
          <Icon fafa="faPrint" width={12} />
        </button>
        <button type="button" className="lvIconeBtn" aria-label="Modifier la tournée" title="Modifier" onClick={() => c.ouvrirFormulaire({ type: "tournee", tournee: t })}>
          <Icon fafa="faPen" width={11} />
        </button>
      </footer>
    </article>
  );
};
