// Campagnes — l'éditeur en trois étapes : audience, contenu, envoi.

import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "../../../../utils/general";
import { modal } from "../../../modalRequest";
import * as D from "@companyos/shared/campagnes";
import { adresseValide } from "@companyos/shared/courrier";
import { ApercuMail, Bouton, Carte, Recherche, initiales, useC } from "../commun";
import { EditeurBlocs, choisirAdressesTest } from "./EditeurBlocs";

const ETAPES = ["audience", "contenu", "envoi"];

/// Valeur d'un `<input type="datetime-local">` pour une date locale.
const versLocal = (d) => {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/// Créneaux rapides : les moments où les mails professionnels sont lus.
const creneaux = (maintenant = new Date()) => {
  const a = (jours, h, m = 0) => {
    const d = new Date(maintenant);
    d.setDate(d.getDate() + jours);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const prochain = (jourSemaine, h, m = 0) => a(((jourSemaine - maintenant.getDay() + 7) % 7) || 7, h, m);
  return [
    { id: "demain8", date: a(1, 8) },
    { id: "lundi9", date: prochain(1, 9) },
    { id: "mardi830", date: prochain(2, 8, 30) },
  ];
};

/// Les blocs de départ d'une campagne neuve.
export const blocsDeDepart = (langue) => [
  D.blocVide("titre", { langue }),
  D.blocVide("texte", { langue }),
  D.blocVide("bouton", { langue }),
  D.blocVide("signature", { langue }),
];

/// Une campagne prête pour l'éditeur : l'ancien format (texte + bouton)
/// est converti en blocs.
const pourEditeur = (base, langue) => {
  const c = { ...D.CAMPAGNE_VIDE, langue, ...base };
  const blocs = (c.blocs || []).length ? c.blocs : String(c.texte || "").trim() ? D.blocsDepuisTexte(c) : blocsDeDepart(c.langue || langue);
  return { ...c, blocs, texte: "", cta: { label: "", url: "" }, filtres: D.normaliserFiltres(c.filtres), exclus: c.exclus || [], ab: { ...D.CAMPAGNE_VIDE.ab, ...(c.ab || {}) } };
};

export const Editeur = () => {
  const s = useC();
  const { t, n, langue, campagnes, clients, contexte, modeles, anciensModeles, membres, session, intention, peutEcrire, occupe, dateHeure, dateCourte, aller, enregistrerBrouillon, lancer, supprimerCampagne, tester, enregistrerModele } = s;
  const fiche = intention?.id ? campagnes.find((c) => c.id === intention.id) : null;
  const [id, setId] = useState(fiche?.id || null);
  const [c, setC] = useState(() => pourEditeur(intention?.initial || fiche?.data || {}, langue));
  const [etape, setEtape] = useState(intention?.initial?.relanceDe ? "contenu" : intention?.etape || "audience");
  const [modifie, setModifie] = useState(!!intention?.initial);
  const [programmer, setProgrammer] = useState(false);
  const [quand, setQuand] = useState("");
  const [testEnvoye, setTestEnvoye] = useState(false);
  const [rechercheDest, setRechercheDest] = useState("");
  const [toutVoir, setToutVoir] = useState(false);

  const maj = (patch) => { setModifie(true); setC((x) => ({ ...x, ...(typeof patch === "function" ? patch(x) : patch) })); };
  const majFiltres = (patch) => maj((x) => ({ filtres: { ...x.filtres, ...patch } }));

  const segment = useMemo(() => D.segmenter(clients, c.filtres, { exclus: c.exclus, contexte }), [clients, c.filtres, c.exclus, contexte]);
  const retenus = segment.retenus;
  const villes = useMemo(() => D.valeursDe(clients, "ville"), [clients]);
  const secteurs = useMemo(() => D.valeursDe(clients, "secteur"), [clients]);
  const etiquettes = useMemo(() => D.etiquettesDe(clients), [clients]);
  const verifs = D.verificationsLancement(c, retenus.length, testEnvoye);
  const bloquants = verifs.filter((v) => !v.ok && !v.conseil && !v.facultatif);

  useEffect(() => {
    if (!modifie) return undefined;
    const avant = (e) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", avant);
    return () => window.removeEventListener("beforeunload", avant);
  }, [modifie]);

  const retour = async () => {
    if (modifie && !(await modal.confirm({ title: t("quitterTitre"), message: t("quitterMessage"), confirmLabel: t("quitter"), danger: true }))) return;
    aller("campagnes");
  };

  const enregistrer = async () => {
    const f = await enregistrerBrouillon(id, c);
    if (f) { setId(f.id); setModifie(false); }
  };

  const partirDUnModele = async () => {
    const choix = await modal.open({
      title: t("partirModele"),
      render: ({ close }) => (
        <div className="cmpChoix">
          {modeles.map((m) => (
            <button key={m.id} type="button" onClick={() => close({ ...m.data })}><b>{m.data.nom}</b><small>{m.data.sujet}</small></button>
          ))}
          {anciensModeles.map((m) => (
            <button key={m.id} type="button" onClick={() => close({ sujet: m.data.sujet, blocs: D.blocsDepuisTexte({ texte: m.data.texte }) })}><b>{m.data.nom}</b><small>{t("modeleCourrier")}</small></button>
          ))}
          {!modeles.length && !anciensModeles.length ? <p>{t("aucunModele")}</p> : null}
        </div>
      ),
    });
    if (!choix) return;
    if (c.blocs.length && !(await modal.confirm({ title: t("remplacerTitre"), message: t("remplacerMessage"), confirmLabel: t("remplacer") }))) return;
    maj({ sujet: choix.sujet || c.sujet, apercu: choix.apercu || c.apercu, couleur: choix.couleur || c.couleur, langue: choix.langue || c.langue, blocs: (choix.blocs || []).map(D.dupliquerBloc) });
  };

  const envoyerTest = async () => {
    const adresses = await choisirAdressesTest({ t, membres, session });
    if (!adresses?.length) return;
    if (await tester(c, adresses, retenus[0])) setTestEnvoye(true);
  };

  const lancerCampagne = () => {
    if (bloquants.length) {
      const premier = bloquants[0].id;
      setEtape(["nom", "audience"].includes(premier) ? "audience" : "contenu");
      return;
    }
    lancer(id, c, retenus, programmer && quand ? new Date(quand).toISOString() : "");
  };

  const fait = {
    audience: !!String(c.nom).trim() && retenus.length > 0,
    contenu: !!String(c.sujet).trim() && D.aUnMessage(c),
    envoi: false,
  };
  const indexEtape = ETAPES.indexOf(etape);

  return (
    <div className="cmpVue cmpVueEditeur">
      <header className="cmpTete cmpTeteEditeur">
        <button type="button" className="cmpRetour" onClick={retour}><Icon fafa="faChevronLeft" width={11} />{t("navCampagnes")}</button>
        <label className="cmpNomInterne">
          <span>{t("nomInterne")}</span>
          <input value={c.nom} placeholder={t("nomInterneExemple")} aria-invalid={!String(c.nom).trim() || undefined} onChange={(e) => maj({ nom: e.target.value })} autoFocus={!fiche && !intention?.initial} />
        </label>
        <ol className="cmpEtapes" aria-label={t("etapes")}>
          {ETAPES.map((e, i) => (
            <li key={e}>
              <button type="button" aria-current={etape === e ? "step" : undefined} data-etat={etape === e ? "actif" : fait[e] || i < indexEtape ? "fait" : ""} onClick={() => setEtape(e)}>
                <b>{etape !== e && fait[e] ? <Icon fafa="faCheck" width={9} /> : i + 1}</b>
                {t(`etape_${e}`)}
                {e === "audience" && retenus.length ? <small>{n(retenus.length)}</small> : null}
              </button>
            </li>
          ))}
        </ol>
        <div className="cmpTeteActions">
          {etape === "contenu" ? (
            <>
              <Bouton icone="faTableCellsLarge" onClick={partirDUnModele}>{t("partirModele")}</Bouton>
              <Bouton icone="faBookmark" disabled={!peutEcrire || !c.blocs.length} onClick={() => enregistrerModele(c)}>{t("enregistrerModele")}</Bouton>
            </>
          ) : null}
          <Bouton icone="faEnvelopeOpenText" disabled={occupe || !c.sujet.trim() || !peutEcrire} onClick={envoyerTest}>{testEnvoye ? t("renvoyerTest") : t("envoyerTest")}</Bouton>
          {id && peutEcrire ? <button type="button" className="cmpIcone" aria-label={t("supprimer")} title={t("supprimer")} onClick={() => supprimerCampagne(campagnes.find((x) => x.id === id) || { id, data: c })}><Icon fafa="faTrashCan" width={12} /></button> : null}
          <Bouton disabled={occupe || !peutEcrire || !String(c.nom).trim()} onClick={enregistrer} title={String(c.nom).trim() ? "" : t("nommerDabord")}>{modifie ? t("enregistrer") : t("enregistre")}</Bouton>
          {etape !== "envoi" ? (
            <Bouton variante="principal" icone="faArrowRight" onClick={() => setEtape(ETAPES[indexEtape + 1])}>{t(etape === "audience" ? "continuerContenu" : "continuerEnvoi")}</Bouton>
          ) : null}
        </div>
      </header>

      {c.relanceDe ? <div className="cmpBandeau" data-ton="orange"><Icon fafa="faRotateRight" width={12} />{t("bandeauRelance", { nom: c.relanceDe })}</div> : null}
      {!peutEcrire ? <div className="cmpBandeau" data-ton="bleu"><Icon fafa="faLock" width={12} />{t("seulAdmin")}</div> : null}

      {etape === "audience" ? (
        <div className="cmpConteneur">
          <div className="cmpGrille">
            <div className="cmpLarge">
              <Carte titre={t("aQui")} aide={t("aQuiAide")}>
                {c.filtres.ids ? <div className="cmpBandeau" data-ton="bleu"><Icon fafa="faUsers" width={12} />{t("listeFermee", { n: n(c.filtres.ids.length) })}</div> : null}
                <div className="cmpCriteres">
                  <span className="cmpCritere">{t("statutCRM")}</span>
                  <div className="cmpChips" role="radiogroup" aria-label={t("statutCRM")}>
                    {["tous", "actif", "prospect", "inactif"].map((x) => (
                      <button key={x} type="button" role="radio" aria-checked={c.filtres.statut === x} className="cmpChipBouton" onClick={() => majFiltres({ statut: x })}>{t(`crm_${x}`)}</button>
                    ))}
                  </div>
                  <span className="cmpCritere">{t("etiquettes")}</span>
                  <ChoixMultiples valeurs={c.filtres.etiquettes} options={etiquettes} tous={t("toutesEtiquettes")} ajouter={t("ajouterEtiquette")} onAjouter={(v) => majFiltres({ etiquettes: [...new Set([...c.filtres.etiquettes, v])] })} onRetirer={(v) => majFiltres({ etiquettes: c.filtres.etiquettes.filter((x) => x !== v) })} />
                  <span className="cmpCritere">{t("villes")}</span>
                  <ChoixMultiples valeurs={c.filtres.villes} options={villes} tous={t("toutesVilles")} ajouter={t("ajouterVille")} onAjouter={(v) => majFiltres({ villes: [...new Set([...c.filtres.villes, v])] })} onRetirer={(v) => majFiltres({ villes: c.filtres.villes.filter((x) => x !== v) })} />
                  <span className="cmpCritere">{t("secteurs")}</span>
                  <ChoixMultiples valeurs={c.filtres.secteurs} options={secteurs} tous={t("tousSecteurs")} ajouter={t("ajouterSecteur")} onAjouter={(v) => majFiltres({ secteurs: [...new Set([...c.filtres.secteurs, v])] })} onRetirer={(v) => majFiltres({ secteurs: c.filtres.secteurs.filter((x) => x !== v) })} />
                  <span className="cmpCritere">{t("activite")}</span>
                  <label className="cmpCase">
                    <input type="checkbox" checked={c.filtres.achatMois > 0} onChange={(e) => majFiltres({ achatMois: e.target.checked ? 6 : 0 })} />
                    <span>{t("aRecuFacture")}</span>
                    <select aria-label={t("periodeAchat")} value={c.filtres.achatMois || 6} onChange={(e) => majFiltres({ achatMois: Number(e.target.value) })}>
                      {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{t(`mois_${m}`)}</option>)}
                    </select>
                  </label>
                  <span className="cmpCritere">{t("pression")}</span>
                  <label className="cmpCase">
                    <input type="checkbox" checked={c.filtres.repos > 0} onChange={(e) => majFiltres({ repos: e.target.checked ? 7 : 0 })} />
                    <span>{t("ecarterRecents")}</span>
                    <select aria-label={t("delaiRepos")} value={c.filtres.repos || 7} onChange={(e) => majFiltres({ repos: Number(e.target.value) })}>
                      {[3, 7, 14, 30].map((j) => <option key={j} value={j}>{t("nJours", { n: j })}</option>)}
                    </select>
                  </label>
                </div>
              </Carte>

              <Carte titre={t("destinataires")} aide={t("destinatairesAide")} actions={<Recherche valeur={rechercheDest} onChanger={setRechercheDest} placeholder={t("rechercherContact")} />}>
                <ListeDestinataires segment={segment} c={c} maj={maj} recherche={rechercheDest} toutVoir={toutVoir} setToutVoir={setToutVoir} />
              </Carte>
            </div>
            <aside className="cmpColonne">
              <section className="cmpAudience" aria-live="polite">
                <span>{t("audienceRetenue")}</span>
                <p><b>{n(retenus.length)}</b> {t("destinatairesMin")}</p>
                <ul>
                  <li>{t("correspondent")}<b>{n(segment.correspondants.length)}</b></li>
                  {segment.sansEmail ? <li>{t("sansEmail")}<b>− {n(segment.sansEmail)}</b></li> : null}
                  {segment.desinscrits ? <li>{t("desinscrits")}<b>− {n(segment.desinscrits)}</b></li> : null}
                  {segment.rebonds ? <li>{t("rebonds")}<b>− {n(segment.rebonds)}</b></li> : null}
                  {segment.aConfirmer ? <li>{t("aConfirmer")}<b>− {n(segment.aConfirmer)}</b></li> : null}
                  {segment.doublons ? <li>{t("doublons")}<b>− {n(segment.doublons)}</b></li> : null}
                  {segment.auRepos ? <li>{t("auRepos")}<b>− {n(segment.auRepos)}</b></li> : null}
                  {segment.exclus ? <li>{t("ecartesMain")}<b>− {n(segment.exclus)}</b></li> : null}
                </ul>
                {retenus.length ? <small>{t("dureeEnvoi", { duree: Math.round(D.dureeEnvoi(retenus.length)) })}</small> : null}
              </section>
              <Verifications verifs={verifs} t={t} />
            </aside>
          </div>
        </div>
      ) : etape === "contenu" ? (
        <EditeurBlocs message={c} onChange={maj} ab exemple={retenus[0]} />
      ) : (
        <div className="cmpConteneur">
          <div className="cmpGrille">
            <div className="cmpLarge">
              <Carte titre={t("quand")}>
                <div className="cmpMoments" role="radiogroup" aria-label={t("quand")}>
                  <button type="button" role="radio" aria-checked={!programmer} onClick={() => setProgrammer(false)}><b>{t("maintenantEnvoi")}</b><small>{t("departMinute")}</small></button>
                  <button type="button" role="radio" aria-checked={programmer} onClick={() => { setProgrammer(true); if (!quand) setQuand(versLocal(creneaux()[0].date)); }}>
                    <b>{t("programmer")}</b><small>{programmer && quand ? dateHeure(new Date(quand).toISOString()) : t("quandLisent")}</small>
                  </button>
                </div>
                {programmer ? (
                  <div className="cmpCreneaux">
                    {creneaux().map((x) => (
                      <button key={x.id} type="button" className="cmpChipBouton" aria-pressed={quand === versLocal(x.date)} onClick={() => setQuand(versLocal(x.date))}>{t(`creneau_${x.id}`)}</button>
                    ))}
                    <input type="datetime-local" aria-label={t("dateHeure")} value={quand} min={versLocal(new Date())} onChange={(e) => setQuand(e.target.value)} />
                  </div>
                ) : null}
                {c.ab?.actif ? <p className="cmpEncadre">{t("abEnvoi", { part: c.ab.part, heures: c.ab.heures })}</p> : null}
              </Carte>
              <Carte titre={t("recapitulatif")}>
                <ul className="cmpRecap">
                  <li><span>{t("nomInterne")}</span><b>{c.nom || "—"}</b></li>
                  <li><span>{t("audienceRetenue")}</span><b>{t("nDestinataires", { n: n(retenus.length) })}</b></li>
                  <li><span>{c.ab?.actif ? t("versionA") : t("objet")}</span><b>{c.sujet || "—"}</b></li>
                  {c.ab?.actif ? <li><span>{t("versionB")}</span><b>{c.ab.sujetB || "—"}</b></li> : null}
                  <li><span>{t("liensSuivis")}</span><b>{n(D.liensDe(c).length)}</b></li>
                  <li><span>{t("dureeEstimee")}</span><b>{retenus.length ? t("nMinutes", { n: Math.round(D.dureeEnvoi(retenus.length)) }) : "—"}</b></li>
                </ul>
              </Carte>
              <div className="cmpLancement">
                <span>
                  {t("nDestinataires", { n: n(retenus.length) })}.
                  {programmer ? ` ${t("annulableDepart")}` : ""}
                  {bloquants.length ? <em> {t("ilManque", { liste: bloquants.map((b) => t(`lancer_${b.id}`)).join(", ") })}</em> : null}
                </span>
                <Bouton variante="principal" icone={programmer ? "faClock" : "faPaperPlane"} disabled={occupe || !peutEcrire || (programmer && !quand)} onClick={lancerCampagne}>
                  {programmer ? t("programmerCampagne") : t("lancerEnvoi")}
                </Bouton>
              </div>
            </div>
            <aside className="cmpColonne cmpColonneLarge">
              <ApercuMail message={c} exemple={retenus[0]} />
              <Verifications verifs={verifs} t={t} />
              {fiche?.data?.creeLe ? <small className="cmpDoux">{t("creeLe", { date: dateCourte(fiche.data.creeLe) })}</small> : null}
            </aside>
          </div>
        </div>
      )}
    </div>
  );
};

const ListeDestinataires = ({ segment, c, maj, recherche, toutVoir, setToutVoir }) => {
  const { t, n, contexte, dateCourte } = useC();
  const q = recherche.trim().toLowerCase();
  const liste = segment.correspondants.filter((x) => !q || [x.data.nom, x.data.entreprise, x.data.email, x.data.ville].some((v) => String(v || "").toLowerCase().includes(q)));
  const basculer = (id) => maj((x) => ({ exclus: x.exclus.includes(id) ? x.exclus.filter((e) => e !== id) : [...x.exclus, id] }));
  return (
    <>
      <div className="cmpTableau" role="table">
        {(toutVoir ? liste : liste.slice(0, 8)).map((x) => {
          const d = x.data;
          const raison = !adresseValide(d.email) ? t("pasEmail") : d.emailDesinscrit ? t("desinscrit") : d.emailRebond ? t("enRebond") : d.emailAConfirmer ? t("nonConfirme") : null;
          const inclus = !raison && !c.exclus.includes(x.id) && segment.retenus.includes(x);
          const auRepos = !raison && !c.exclus.includes(x.id) && !segment.retenus.includes(x);
          const achat = contexte.derniereFacture?.[x.id];
          return (
            <div key={x.id} className="cmpLigneT cmpColsDest" role="row" data-inactif={!inclus || undefined}>
              <input type="checkbox" aria-label={d.entreprise || d.nom} checked={inclus} disabled={!!raison || auRepos} onChange={() => basculer(x.id)} />
              <span className="cmpPersonne"><span className="cmpAvatar" aria-hidden="true">{initiales(d.entreprise || d.nom)}</span><b className="cmpEllipse">{d.entreprise || d.nom}</b></span>
              <span className="cmpDoux cmpEllipse">{d.email || "—"}</span>
              <span className="cmpEllipse">{(d.etiquettes || []).join(", ") || d.ville || "—"}</span>
              <small className="cmpDoux">{raison || (auRepos ? t("auReposLigne") : achat ? t("factureLe", { date: dateCourte(achat) }) : "")}</small>
            </div>
          );
        })}
        {!liste.length ? <p className="cmpRien">{t("personne")}</p> : null}
      </div>
      {liste.length > 8 ? (
        <div className="cmpCartePied">
          {t("affichesSur", { a: n(toutVoir ? liste.length : 8), b: n(liste.length) })} · <button type="button" className="cmpLien" onClick={() => setToutVoir(!toutVoir)}>{toutVoir ? t("reduire") : t("toutVoir")}</button>
        </div>
      ) : null}
    </>
  );
};

export const ChoixMultiples = ({ valeurs, options, tous, ajouter, onAjouter, onRetirer }) => {
  const restantes = options.filter((o) => !valeurs.includes(o));
  return (
    <div className="cmpChips">
      {valeurs.map((v) => (
        <span key={v} className="cmpJeton">
          {v}
          <button type="button" aria-label={`× ${v}`} onClick={() => onRetirer(v)}><Icon fafa="faXmark" width={9} /></button>
        </span>
      ))}
      {!valeurs.length ? <span className="cmpDoux">{tous}</span> : null}
      {restantes.length ? (
        <select className="cmpAjouter" aria-label={ajouter} value="" onChange={(e) => onAjouter(e.target.value)}>
          <option value="">+ {ajouter}</option>
          {restantes.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : null}
    </div>
  );
};

const Verifications = ({ verifs, t }) => (
  <Carte titre={t("avantLancer")}>
    <ul className="cmpVerifs">
      {verifs.filter((v) => !v.facultatif).map((v) => (
        <li key={v.id} data-ok={v.ok || undefined} data-conseil={v.conseil || undefined}>
          <span aria-hidden="true">{v.ok ? <Icon fafa="faCheck" width={9} /> : null}</span>
          {t(`lancer_${v.id}`)}
          {v.conseil && !v.ok ? <small>{t("conseille")}</small> : null}
        </li>
      ))}
    </ul>
  </Carte>
);
