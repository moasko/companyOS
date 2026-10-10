// L'éditeur d'une automatisation : Quand → Si → Alors.
//
// Tout est validé par les mêmes règles que le serveur
// (`validerAutomatisation`, packages/shared) avant l'envoi ; l'essai à
// blanc montre, sur une vraie fiche, si l'automatisation s'exécuterait et
// ce que ses textes deviendraient — sans rien exécuter.

import React, { useEffect, useMemo, useState } from "react";
import {
  COLLECTIONS,
  EVENEMENTS,
  MODES_DESTINATAIRES,
  OPERATEURS,
  OPERATEURS_AVEC_VALEUR,
  TYPES_ACTION,
  validerAutomatisation,
} from "@companyos/shared/automatisations";
import { Icon } from "../../../utils/general";
import { api } from "../../../api/client";
import { Bouton, Notice } from "../../ui";

const cleCollection = (module, collection) => `${module}/${collection}`;
const connue = (module, collection) => COLLECTIONS.find((c) => c.module === module && c.collection === collection);

const ACTION_NEUVE = {
  notifier: () => ({ type: "notifier", destinataires: { mode: "admins" }, titre: "", message: "" }),
  courriel: () => ({ type: "courriel", destinataires: { mode: "admins" }, sujet: "", texte: "" }),
  creer: () => ({ type: "creer", module: "crm", collection: "activites", donnees: { type: "note", resume: "" } }),
  modifier: () => ({ type: "modifier", champs: { "": "" } }),
  tache: () => ({ type: "tache", tableauId: "", titre: "", description: "", assigne: "", echeance: "{{date:+7}}" }),
  webhook: () => ({ type: "webhook", url: "https://" }),
};

/// Saisie avec suggestions (les champs connus de la collection).
const Saisie = ({ valeur, onChange, liste, placeholder, id, ...reste }) => (
  <>
    <input value={valeur ?? ""} placeholder={placeholder} list={liste ? id : undefined} onChange={(e) => onChange(e.target.value)} {...reste} />
    {liste ? (
      <datalist id={id}>
        {liste.map((x) => (
          <option key={x} value={x} />
        ))}
      </datalist>
    ) : null}
  </>
);

/// Paires champ → valeur (création, modification).
const Paires = ({ t, valeur, onChange, champs, idListe }) => {
  const paires = Object.entries(valeur || {});
  const poser = (liste) => onChange(Object.fromEntries(liste));
  return (
    <div className="autPaires">
      {paires.map(([k, v], i) => (
        <div key={i} className="autPaire">
          <Saisie
            id={`${idListe}-${i}`}
            liste={champs}
            valeur={k}
            placeholder={t("champ")}
            aria-label={t("champ")}
            onChange={(nk) => poser(paires.map((p, j) => (j === i ? [nk, p[1]] : p)))}
          />
          <input
            value={typeof v === "string" ? v : String(v)}
            placeholder={t("valeur")}
            aria-label={t("valeur")}
            onChange={(e) => poser(paires.map((p, j) => (j === i ? [p[0], e.target.value] : p)))}
          />
          <button type="button" className="autIcone" title={t("retirer")} onClick={() => poser(paires.filter((_, j) => j !== i))}>
            <Icon fafa="faXmark" width={10} />
          </button>
        </div>
      ))}
      <button type="button" className="autLien" onClick={() => poser([...paires, ["", ""]])}>
        + {t("ajouterChamp")}
      </button>
    </div>
  );
};

const Destinataires = ({ t, valeur, onChange, champsPersonnes, membres, idListe }) => (
  <div className="autGrille">
    <label className="autChamp">
      <span>{t("dest")}</span>
      <select value={valeur?.mode || "admins"} onChange={(e) => onChange({ mode: e.target.value, ...(e.target.value === "champ" ? { champ: champsPersonnes[0] || "" } : {}), ...(e.target.value === "membres" ? { ids: [] } : {}) })}>
        {MODES_DESTINATAIRES.map((m) => (
          <option key={m} value={m}>
            {t(`dest_${m}`)}
          </option>
        ))}
      </select>
    </label>
    {valeur?.mode === "champ" ? (
      <label className="autChamp">
        <span>{t("champ")}</span>
        <Saisie id={idListe} liste={champsPersonnes} valeur={valeur.champ} onChange={(champ) => onChange({ ...valeur, champ })} />
      </label>
    ) : null}
    {valeur?.mode === "membres" ? (
      <div className="autChamp autChampPlein">
        <span>{t("personne")}</span>
        <div className="autMembres">
          {membres.map((m) => {
            const coche = (valeur.ids || []).includes(m.id);
            return (
              <label key={m.id} className="autMembre" data-coche={coche ? "true" : "false"}>
                <input
                  type="checkbox"
                  checked={coche}
                  onChange={() => onChange({ ...valeur, ids: coche ? valeur.ids.filter((x) => x !== m.id) : [...(valeur.ids || []), m.id] })}
                />
                {m.name}
              </label>
            );
          })}
        </div>
      </div>
    ) : null}
  </div>
);

const Action = ({ t, action, index, onChange, onRetirer, champs, champsPersonnes, membres, tableaux, idAutomatisation }) => {
  const poser = (patch) => onChange({ ...action, ...patch });
  const [secret, setSecret] = useState(null);
  useEffect(() => {
    if (action.type !== "webhook" || !idAutomatisation) return;
    api.automatisations
      .secret(idAutomatisation)
      .then((r) => setSecret(r.secret))
      .catch(() => setSecret(null));
  }, [action.type, idAutomatisation]);

  const cible = connue(action.module, action.collection);
  return (
    <div className="autAction">
      <div className="autActionTete">
        <span className="autNumero">{index + 1}</span>
        <strong>{t(`act_${action.type}`)}</strong>
        <span className="autEspace" />
        <button type="button" className="autIcone" title={t("retirer")} onClick={onRetirer}>
          <Icon fafa="faTrashCan" width={11} />
        </button>
      </div>

      {action.type === "notifier" || action.type === "courriel" ? (
        <>
          <Destinataires t={t} valeur={action.destinataires} onChange={(destinataires) => poser({ destinataires })} champsPersonnes={champsPersonnes} membres={membres} idListe={`dest-${index}`} />
          <label className="autChamp autChampPlein">
            <span>{t(action.type === "notifier" ? "titreNotif" : "sujet")}</span>
            <input value={action.type === "notifier" ? action.titre : action.sujet} onChange={(e) => poser(action.type === "notifier" ? { titre: e.target.value } : { sujet: e.target.value })} />
          </label>
          <label className="autChamp autChampPlein">
            <span>{t(action.type === "notifier" ? "message" : "texte")}</span>
            <textarea rows={action.type === "notifier" ? 2 : 5} value={action.type === "notifier" ? action.message : action.texte} onChange={(e) => poser(action.type === "notifier" ? { message: e.target.value } : { texte: e.target.value })} />
          </label>
        </>
      ) : null}

      {action.type === "creer" ? (
        <>
          <label className="autChamp autChampPlein">
            <span>{t("cible")}</span>
            <select
              value={cleCollection(action.module, action.collection)}
              onChange={(e) => {
                const [module, collection] = e.target.value.split("/");
                poser({ module, collection });
              }}
            >
              {!cible ? <option value={cleCollection(action.module, action.collection)}>{cleCollection(action.module, action.collection)}</option> : null}
              {COLLECTIONS.map((c) => (
                <option key={cleCollection(c.module, c.collection)} value={cleCollection(c.module, c.collection)}>
                  {c.libelle}
                </option>
              ))}
            </select>
          </label>
          <div className="autChamp autChampPlein">
            <span>{t("champs")}</span>
            <Paires t={t} valeur={action.donnees} onChange={(donnees) => poser({ donnees })} champs={cible?.champs} idListe={`creer-${index}`} />
          </div>
        </>
      ) : null}

      {action.type === "modifier" ? (
        <div className="autChamp autChampPlein">
          <span>{t("champs")}</span>
          <Paires t={t} valeur={action.champs} onChange={(c) => poser({ champs: c })} champs={champs} idListe={`modifier-${index}`} />
        </div>
      ) : null}

      {action.type === "tache" ? (
        <div className="autGrille">
          <label className="autChamp">
            <span>{t("tableau")}</span>
            <select value={action.tableauId || ""} onChange={(e) => poser({ tableauId: e.target.value })}>
              <option value="">{t("premierTableau")}</option>
              {tableaux.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.data?.nom || b.id}
                </option>
              ))}
            </select>
          </label>
          <label className="autChamp">
            <span>{t("assigne")}</span>
            <Saisie id={`assigne-${index}`} liste={champsPersonnes} valeur={action.assigne} onChange={(assigne) => poser({ assigne })} />
          </label>
          <label className="autChamp autChampPlein">
            <span>{t("titreNotif")}</span>
            <input value={action.titre} onChange={(e) => poser({ titre: e.target.value })} />
          </label>
          <label className="autChamp autChampPlein">
            <span>{t("description")}</span>
            <textarea rows={2} value={action.description} onChange={(e) => poser({ description: e.target.value })} />
          </label>
          <label className="autChamp">
            <span>{t("echeance")}</span>
            <input value={action.echeance} onChange={(e) => poser({ echeance: e.target.value })} placeholder="{{date:+7}}" />
          </label>
        </div>
      ) : null}

      {action.type === "webhook" ? (
        <>
          <label className="autChamp autChampPlein">
            <span>{t("url")}</span>
            <input type="url" value={action.url} onChange={(e) => poser({ url: e.target.value })} placeholder="https://hooks.zapier.com/…" />
          </label>
          <div className="autChamp autChampPlein">
            <span>{t("secret")}</span>
            {secret ? <code className="autSecret">{secret}</code> : <span className="autMuted">{t("secretApres")}</span>}
            <span className="autMuted autPetit">{t("secretAide")}</span>
          </div>
        </>
      ) : null}
    </div>
  );
};

export const Editeur = ({ t, id, initial, membres, onRetour, onEnregistrer }) => {
  const [a, setA] = useState(initial);
  const [erreurs, setErreurs] = useState([]);
  const [occupe, setOccupe] = useState(false);
  const [essai, setEssai] = useState(null);
  const [copieInfo, setCopieInfo] = useState("");
  const [tableaux, setTableaux] = useState([]);
  const [libre, setLibre] = useState(() => !connue(initial.declencheur.module, initial.declencheur.collection));

  useEffect(() => setA(initial), [initial]);
  useEffect(() => {
    if (!a.actions.some((x) => x.type === "tache")) return;
    api.records.list("projets", "tableaux").then(setTableaux).catch(() => setTableaux([]));
  }, [a.actions]);

  const d = a.declencheur;
  const col = connue(d.module, d.collection);
  const champs = useMemo(() => col?.champs || [], [col]);
  const champsPersonnes = useMemo(() => {
    const ids = champs.filter((c) => /Id$/.test(c) && !/^(client|opportunite|document|tableau|colonne|article|fournisseur|entrepot|categorie)Id$/.test(c));
    return ids.length ? ids : ["responsableId"];
  }, [champs]);

  const poser = (patch) => setA((x) => ({ ...x, ...patch }));
  const poserD = (patch) => setA((x) => ({ ...x, declencheur: { ...x.declencheur, ...patch } }));

  const balises = useMemo(() => {
    const base = champs.map((c) => `{{fiche.${c}}}`);
    if (d.evenement === "modification") base.push(...champs.slice(0, 3).map((c) => `{{avant.${c}}}`));
    if (d.lier) base.push("{{lie.numero}}", "{{lie.clientId}}");
    return [...base, "{{fiche.id}}", "{{auteur.nom}}", "{{date}}", "{{date:+7}}", "{{maintenant}}"];
  }, [champs, d.evenement, d.lier]);

  const copier = async (b) => {
    try {
      await navigator.clipboard.writeText(b);
    } catch {
      // Presse-papiers refusé : la balise reste lisible à l'écran.
    }
    setCopieInfo(t("copie", { b }));
    setTimeout(() => setCopieInfo(""), 2000);
  };

  const verifier = () => {
    const r = validerAutomatisation(a);
    setErreurs(r.ok ? [] : r.erreurs);
    return r;
  };

  const enregistrer = async () => {
    const r = verifier();
    if (!r.ok) return;
    setOccupe(true);
    try {
      await onEnregistrer(r.valeur);
    } catch (e) {
      setErreurs(e.message ? [e.message] : []);
    } finally {
      setOccupe(false);
    }
  };

  const essayer = async () => {
    const r = verifier();
    if (!r.ok) return;
    setOccupe(true);
    try {
      setEssai(await api.automatisations.essai(r.valeur));
    } catch (e) {
      setErreurs([e.message]);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="autEditeur">
      <header className="autEditeurBarre">
        <button type="button" className="autLien" onClick={onRetour}>
          <Icon fafa="faChevronLeft" width={10} /> {t("retour")}
        </button>
        <input className="autNom" value={a.nom} placeholder={t("nom")} aria-label={t("nom")} onChange={(e) => poser({ nom: e.target.value })} />
        <Bouton variante="secondaire" icone="faFlask" off={occupe} onClick={essayer}>
          {t("essayer")}
        </Bouton>
        <Bouton icone="faCheck" off={occupe} onClick={enregistrer}>
          {t("enregistrer")}
        </Bouton>
      </header>

      <div className="autEditeurCorps">
        <div className="autEditeurCentre cosScroll">
          {erreurs.length ? (
            <Notice ton="erreur" icone="faTriangleExclamation">
              <strong>{t("erreurs")} : </strong>
              {erreurs.join(" · ")}
            </Notice>
          ) : null}

          <section className="autEtape">
            <h2>
              <span className="autEtapeMot">{t("quand")}</span>
            </h2>
            <div className="autGrille">
              <label className="autChamp">
                <span>{t("collection")}</span>
                <select
                  value={libre ? "__autre" : cleCollection(d.module, d.collection)}
                  onChange={(e) => {
                    if (e.target.value === "__autre") {
                      setLibre(true);
                      return;
                    }
                    setLibre(false);
                    const [module, collection] = e.target.value.split("/");
                    poserD({ module, collection, champ: undefined });
                  }}
                >
                  {COLLECTIONS.map((c) => (
                    <option key={cleCollection(c.module, c.collection)} value={cleCollection(c.module, c.collection)}>
                      {c.libelle}
                    </option>
                  ))}
                  <option value="__autre">{t("autreCollection")}</option>
                </select>
              </label>
              {libre ? (
                <>
                  <label className="autChamp">
                    <span>{t("module")}</span>
                    <input value={d.module} onChange={(e) => poserD({ module: e.target.value.toLowerCase() })} />
                  </label>
                  <label className="autChamp">
                    <span>{t("collectionLibre")}</span>
                    <input value={d.collection} onChange={(e) => poserD({ collection: e.target.value.toLowerCase() })} />
                  </label>
                </>
              ) : null}
              <div className="autChamp autChampPlein">
                <span>{t("evenement")}</span>
                <div className="autChoix" role="radiogroup">
                  {EVENEMENTS.map((ev) => (
                    <button key={ev} type="button" role="radio" aria-checked={d.evenement === ev} className="autPastille" onClick={() => poserD({ evenement: ev })}>
                      {t(`ev_${ev}`)}
                    </button>
                  ))}
                </div>
              </div>
              {d.evenement === "modification" ? (
                <label className="autChamp">
                  <span>{t("champSurveille")}</span>
                  <Saisie id="champ-surveille" liste={champs} valeur={d.champ || ""} placeholder={t("nimporteQuelChamp")} onChange={(champ) => poserD({ champ: champ || undefined })} />
                </label>
              ) : null}
              <label className="autCase autChampPlein">
                <input
                  type="checkbox"
                  checked={!!d.lier}
                  onChange={(e) => poserD({ lier: e.target.checked ? { champ: "documentId", module: "facturation", collection: "factures" } : undefined })}
                />
                <span>{t("lier")}</span>
              </label>
              {d.lier ? (
                <>
                  <label className="autChamp">
                    <span>{t("lierChamp")}</span>
                    <Saisie id="lier-champ" liste={champs} valeur={d.lier.champ} onChange={(champ) => poserD({ lier: { ...d.lier, champ } })} />
                  </label>
                  <label className="autChamp">
                    <span>{t("cible")}</span>
                    <select
                      value={cleCollection(d.lier.module, d.lier.collection)}
                      onChange={(e) => {
                        const [module, collection] = e.target.value.split("/");
                        poserD({ lier: { ...d.lier, module, collection } });
                      }}
                    >
                      {COLLECTIONS.map((c) => (
                        <option key={cleCollection(c.module, c.collection)} value={cleCollection(c.module, c.collection)}>
                          {c.libelle}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="autMuted autPetit autChampPlein">{t("lierAide")}</p>
                </>
              ) : null}
            </div>
          </section>

          <section className="autEtape">
            <h2>
              <span className="autEtapeMot">{t("si")}</span>
              {a.conditions.length > 1 ? (
                <span className="autChoix">
                  <button type="button" className="autPastille" aria-checked={a.toutes !== false} role="radio" onClick={() => poser({ toutes: true })}>
                    {t("toutes")}
                  </button>
                  <button type="button" className="autPastille" aria-checked={a.toutes === false} role="radio" onClick={() => poser({ toutes: false })}>
                    {t("uneSeule")}
                  </button>
                </span>
              ) : null}
            </h2>
            {!a.conditions.length ? <p className="autMuted">{t("sansCondition")}</p> : null}
            {a.conditions.map((c, i) => (
              <div key={i} className="autCondition">
                <Saisie
                  id={`cond-${i}`}
                  liste={champs}
                  valeur={c.champ}
                  placeholder={t("champ")}
                  aria-label={t("champ")}
                  onChange={(champ) => poser({ conditions: a.conditions.map((x, j) => (j === i ? { ...x, champ } : x)) })}
                />
                <select
                  value={c.operateur}
                  aria-label="opérateur"
                  onChange={(e) => poser({ conditions: a.conditions.map((x, j) => (j === i ? { ...x, operateur: e.target.value } : x)) })}
                >
                  {OPERATEURS.map((o) => (
                    <option key={o} value={o}>
                      {t(`op_${o}`)}
                    </option>
                  ))}
                </select>
                {OPERATEURS_AVEC_VALEUR.includes(c.operateur) ? (
                  <input
                    className="autCondValeur"
                    value={c.valeur ?? ""}
                    placeholder={t("valeur")}
                    aria-label={t("valeur")}
                    onChange={(e) => poser({ conditions: a.conditions.map((x, j) => (j === i ? { ...x, valeur: e.target.value } : x)) })}
                  />
                ) : (
                  <span className="autCondValeur" />
                )}
                <button type="button" className="autIcone" title={t("retirer")} onClick={() => poser({ conditions: a.conditions.filter((_, j) => j !== i) })}>
                  <Icon fafa="faXmark" width={10} />
                </button>
              </div>
            ))}
            <button type="button" className="autLien" onClick={() => poser({ conditions: [...a.conditions, { champ: champs[0] || "", operateur: "egal", valeur: "" }] })}>
              + {t("ajouterCondition")}
            </button>
          </section>

          <section className="autEtape">
            <h2>
              <span className="autEtapeMot">{t("alors")}</span>
            </h2>
            {a.actions.map((x, i) => (
              <Action
                key={i}
                t={t}
                action={x}
                index={i}
                champs={champs}
                champsPersonnes={champsPersonnes}
                membres={membres}
                tableaux={tableaux}
                idAutomatisation={id}
                onChange={(nouvelle) => poser({ actions: a.actions.map((y, j) => (j === i ? nouvelle : y)) })}
                onRetirer={() => poser({ actions: a.actions.filter((_, j) => j !== i) })}
              />
            ))}
            <div className="autAjoutAction">
              <select
                value=""
                aria-label={t("ajouterAction")}
                onChange={(e) => e.target.value && poser({ actions: [...a.actions, ACTION_NEUVE[e.target.value]()] })}
              >
                <option value="">+ {t("ajouterAction")}</option>
                {TYPES_ACTION.filter((ty) => !(ty === "modifier" && d.evenement === "suppression")).map((ty) => (
                  <option key={ty} value={ty}>
                    {t(`act_${ty}`)}
                  </option>
                ))}
              </select>
            </div>
          </section>
        </div>

        <aside className="autEditeurCote cosScroll">
          <section>
            <h3>{t("balises")}</h3>
            <p className="autMuted autPetit">{t("balisesAide")}</p>
            <div className="autBalises">
              {balises.map((b) => (
                <button key={b} type="button" className="autBalise" onClick={() => copier(b)}>
                  {b}
                </button>
              ))}
            </div>
            {copieInfo ? <p className="autMuted autPetit">{copieInfo}</p> : null}
          </section>

          <section>
            <h3>{t("essayer")}</h3>
            <p className="autMuted autPetit">{t("essaiAide")}</p>
            {essai ? (
              !essai.fiche ? (
                <Notice ton="info">{t("essaiVide")}</Notice>
              ) : (
                <div className="autEssai">
                  <Notice ton={essai.correspond ? "succes" : "attention"}>{t(essai.correspond ? "essaiOui" : "essaiNon")}</Notice>
                  <p className="autMuted autPetit">
                    {t("fiche")} : {essai.fiche.data?.nom || essai.fiche.data?.libelle || essai.fiche.data?.titre || essai.fiche.data?.numero || essai.fiche.id}
                  </p>
                  {essai.conditions.length ? (
                    <ul className="autEssaiConds">
                      {essai.conditions.map((c, i) => (
                        <li key={i} data-vraie={c.vraie ? "true" : "false"}>
                          <Icon fafa={c.vraie ? "faCheck" : "faXmark"} width={10} />
                          {c.champ} {t(`op_${c.operateur}`)} {c.valeur ?? ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {essai.apercu.map((p, i) => (
                    <div key={i} className="autApercu">
                      <strong>
                        {i + 1}. {t(`act_${p.type}`)}
                      </strong>
                      {p.titre ? <div>{String(p.titre)}</div> : null}
                      {p.sujet ? <div>{String(p.sujet)}</div> : null}
                      {p.message ? <div className="autMuted">{String(p.message)}</div> : null}
                      {p.texte ? <div className="autMuted">{String(p.texte).slice(0, 200)}</div> : null}
                      {p.donnees || p.champs ? (
                        <dl>
                          {Object.entries(p.donnees || p.champs).map(([k, v]) => (
                            <React.Fragment key={k}>
                              <dt>{k}</dt>
                              <dd>{String(v)}</dd>
                            </React.Fragment>
                          ))}
                        </dl>
                      ) : null}
                      {p.url ? <div className="autMuted">{p.url}</div> : null}
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
};
