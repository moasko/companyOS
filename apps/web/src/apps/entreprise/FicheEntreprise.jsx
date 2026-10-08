import React, { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Icon } from "../../utils/general";
import { choisirImage, reduireImage } from "../image";
import { saveToCloud } from "../cloud";
import { choisirFichierCloud, blobDuFichier } from "../ChoisirFichier";
import { ouvrirFenetre } from "../windows";
import { imageSignature } from "../modules/signature/domaine";
import {
  RUBRIQUES,
  TAILLE_MAX,
  chargerSignatures,
  enregistrerEntreprise,
  ficheVide,
  manquesDe,
  tailleFiche,
  useEntreprise,
} from "./index";
import "./fiche.scss";

// Le formulaire de la fiche de l'entreprise.
//
// Le même composant sert dans les Paramètres (rubrique « Fiche de
// l'entreprise ») et dans les applications qui en ont besoin au moment où
// elles en ont besoin — l'Éditeur de factures l'ouvre dans un volet, sans
// envoyer l'utilisateur ailleurs. Deux écrans, une seule fiche.
//
// `repli` : des valeurs à proposer quand la fiche est encore vide (par
// exemple le profil qu'une application gardait avant que la fiche
// n'existe). Rien n'est enregistré sans clic.

const IMAGES = {
  logo: { titre: "Logo", aide: "PNG ou JPG, fond clair de préférence", max: 320, qualite: 0.86 },
  cachet: { titre: "Cachet de l'entreprise", aide: "Le tampon, apposé à côté de la signature", max: 240, qualite: 0.8 },
};

const CarteImage = ({ type, valeur, lectureSeule, occupe, onImporter, onCloud, onRetirer }) => {
  const def = IMAGES[type];
  return (
    <div className="feCarteImage">
      <span className="feImage" data-vide={!valeur}>
        {valeur ? <img src={valeur} alt={def.titre} /> : <Icon fafa={type === "logo" ? "faImage" : "faStamp"} width={20} />}
      </span>
      <div className="feCarteTexte">
        <b>{def.titre}</b>
        <small>{def.aide}</small>
        {!lectureSeule ? (
          <div className="feActions">
            <button type="button" className="feBouton" disabled={occupe} onClick={onImporter}>
              <Icon fafa="faUpload" width={11} />
              <span>Importer</span>
            </button>
            <button type="button" className="feBouton" disabled={occupe} onClick={onCloud}>
              <Icon fafa="faCloud" width={11} />
              <span>Depuis le Cloud</span>
            </button>
            {valeur ? (
              <button type="button" className="feLien" disabled={occupe} onClick={onRetirer}>Retirer</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const FicheEntreprise = ({ repli = null, onEnregistre, compact = false }) => {
  const session = useSelector((s) => s.session);
  const lectureSeule = !["OWNER", "ADMIN"].includes(session.user?.role);
  const { entreprise, charge } = useEntreprise();
  const [brouillon, setBrouillon] = useState(null);
  const [modifie, setModifie] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null);
  const [signatures, setSignatures] = useState(null);

  // Le brouillon part de la fiche enregistrée, ou du repli proposé.
  useEffect(() => {
    if (!charge || modifie) return;
    setBrouillon({ ...ficheVide(session.tenant?.name || ""), ...(entreprise || repli || {}) });
  }, [charge, entreprise, repli, modifie, session.tenant?.name]);

  const rafraichirSignatures = () => chargerSignatures().then(setSignatures);
  useEffect(() => { rafraichirSignatures(); }, []);

  const maj = (patch) => {
    setModifie(true);
    setMessage(null);
    setBrouillon((b) => ({ ...b, ...patch }));
  };

  const manques = useMemo(() => manquesDe(brouillon || {}), [brouillon]);
  const poids = useMemo(() => (brouillon ? tailleFiche(brouillon) : 0), [brouillon]);
  const emailInvalide = brouillon?.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brouillon.email);

  const poserImage = async (type, source, nomFichier) => {
    setOccupe(true);
    try {
      const def = IMAGES[type];
      const { url } = await reduireImage(source, { max: def.max, qualite: def.qualite });
      maj({ [type]: url });
      // L'original rejoint le dossier « Entreprise » du Cloud : on le
      // retrouve dans le gestionnaire de fichiers, en pleine résolution.
      if (source instanceof File) {
        const noeud = await saveToCloud(source, nomFichier || source.name, { folder: "Entreprise" }).catch(() => null);
        if (noeud?.id) maj({ [`${type}FichierId`]: noeud.id });
      }
    } catch (e) {
      setMessage({ ton: "erreur", texte: e.message });
    } finally {
      setOccupe(false);
    }
  };

  const importer = (type) => async () => {
    const fichier = await choisirImage();
    if (fichier) poserImage(type, fichier, `${type === "logo" ? "Logo" : "Cachet"} - ${fichier.name}`);
  };

  const depuisCloud = (type) => async () => {
    const node = await choisirFichierCloud({ titre: `${IMAGES[type].titre} — choisir une image`, filtre: "image", dossier: "Entreprise" });
    if (!node) return;
    try {
      setOccupe(true);
      const blob = await blobDuFichier(node);
      await poserImage(type, blob);
      maj({ [`${type}FichierId`]: node.id });
    } catch (e) {
      setMessage({ ton: "erreur", texte: e.message });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrer = async () => {
    if (emailInvalide) {
      setMessage({ ton: "erreur", texte: "L'adresse e-mail n'est pas valide." });
      return;
    }
    setOccupe(true);
    try {
      const propre = Object.fromEntries(Object.entries(brouillon).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
      await enregistrerEntreprise(propre);
      setModifie(false);
      setMessage({ ton: "ok", texte: "Fiche enregistrée : toutes les applications l'utilisent désormais." });
      onEnregistre?.(propre);
    } catch (e) {
      setMessage({ ton: "erreur", texte: e.message });
    } finally {
      setOccupe(false);
    }
  };

  const annuler = () => {
    setModifie(false);
    setMessage(null);
  };

  if (!brouillon) return <div className="feFiche feChargement">Chargement de la fiche…</div>;

  const signatureChoisie = signatures?.find((s) => s.id === brouillon.signatureId);

  return (
    <div className="feFiche" data-compact={compact}>
      {lectureSeule ? (
        <div className="feAvis">
          <Icon fafa="faLock" width={12} />
          <span>Seuls les administrateurs de l'espace modifient la fiche de l'entreprise.</span>
        </div>
      ) : manques.length ? (
        <div className="feAvis" data-ton="attention">
          <Icon fafa="faCircleExclamation" width={12} />
          <span>À compléter pour des documents en règle : {manques.join(", ")}.</span>
        </div>
      ) : (
        <div className="feAvis" data-ton="ok">
          <Icon fafa="faCircleCheck" width={12} />
          <span>Fiche complète : vos documents portent toutes les mentions utiles.</span>
        </div>
      )}

      {!entreprise && repli && !modifie && !lectureSeule ? (
        <div className="feAvis" data-ton="info">
          <Icon fafa="faWandMagicSparkles" width={12} />
          <span>Nous avons prérempli la fiche avec les informations déjà saisies. Vérifiez-les, puis enregistrez.</span>
        </div>
      ) : null}

      <section className="feRubrique">
        <h4>Images</h4>
        <div className="feImages">
          {Object.keys(IMAGES).map((type) => (
            <CarteImage
              key={type}
              type={type}
              valeur={brouillon[type]}
              lectureSeule={lectureSeule}
              occupe={occupe}
              onImporter={importer(type)}
              onCloud={depuisCloud(type)}
              onRetirer={() => maj({ [type]: "", [`${type}FichierId`]: "" })}
            />
          ))}
        </div>
      </section>

      {RUBRIQUES.map((r) => (
        <section key={r.id} className="feRubrique">
          <h4>{r.titre}</h4>
          <div className="feGrille">
            {r.champs.map((c) => {
              const valeur = brouillon[c.id] || "";
              const invalide = c.id === "email" && emailInvalide;
              const props = {
                id: `fe-${c.id}`,
                value: valeur,
                disabled: lectureSeule,
                "aria-invalid": invalide || undefined,
                onChange: (e) => maj({ [c.id]: e.target.value }),
              };
              return (
                <label key={c.id} className="feChamp" data-large={!!c.large} data-invalide={!!invalide}>
                  <span>
                    {c.label}
                    {c.requis ? <em aria-hidden="true"> *</em> : null}
                  </span>
                  {c.liste ? (
                    <select {...props}>
                      {c.liste.map((o) => <option key={o} value={o}>{o || "—"}</option>)}
                      {valeur && !c.liste.includes(valeur) ? <option value={valeur}>{valeur}</option> : null}
                    </select>
                  ) : c.multiligne ? (
                    <textarea rows={2} placeholder={c.placeholder} {...props} />
                  ) : (
                    <input type={c.type || "text"} placeholder={c.placeholder} required={c.requis} {...props} />
                  )}
                  {invalide ? <small className="feErreur">Format attendu : nom@domaine.ci</small> : null}
                </label>
              );
            })}
          </div>

          {r.id === "signataire" ? (
            <div className="feSignatures">
              <div className="feSignaturesTete">
                <b>Signature manuscrite</b>
                <small>Celles dessinées dans l'application Signature</small>
              </div>
              <div className="feSignaturesListe" role="radiogroup" aria-label="Signature">
                <button
                  type="button"
                  role="radio"
                  aria-checked={!brouillon.signatureId}
                  className="feSignature"
                  disabled={lectureSeule}
                  onClick={() => maj({ signatureId: "", signatureNom: "" })}
                >
                  <span className="feSignatureNom">{brouillon.signataire || brouillon.nom || "Nom"}</span>
                  <small>Nom en écriture cursive</small>
                </button>
                {(signatures || []).map((s) => (
                  <button
                    type="button"
                    role="radio"
                    key={s.id}
                    aria-checked={brouillon.signatureId === s.id}
                    className="feSignature"
                    disabled={lectureSeule}
                    onClick={() => maj({ signatureId: s.id, signatureNom: s.data.nom || "" })}
                  >
                    <img src={imageSignature(s.data)} alt={`Signature de ${s.data.nom || "—"}`} />
                    <small>{s.data.nom || "Sans nom"}</small>
                  </button>
                ))}
                {!lectureSeule ? (
                  <button type="button" className="feSignature feSignatureNouvelle" onClick={() => ouvrirFenetre("signature")}>
                    <Icon fafa="faPenNib" width={14} />
                    <small>Dessiner une signature</small>
                  </button>
                ) : null}
              </div>
              {signatures === null ? <small className="feDoux">Chargement des signatures…</small> : null}
              {brouillon.signatureId && signatures && !signatureChoisie ? (
                <small className="feDoux">La signature choisie n'est plus disponible dans l'application Signature.</small>
              ) : null}
              {!lectureSeule ? (
                <button type="button" className="feLien" onClick={rafraichirSignatures}>
                  <Icon fafa="faRotate" width={10} /> Actualiser la liste
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ))}

      {!lectureSeule ? (
        <div className="fePied">
          {message ? (
            <span className="feMessage" data-ton={message.ton} role="status">{message.texte}</span>
          ) : (
            <span className="feDoux">
              {modifie ? "Modifications non enregistrées" : "Utilisée par la Facturation, l'Éditeur de factures et les autres applications"}
              {poids > TAILLE_MAX * 0.8 ? ` · ${Math.round(poids / 1024)} Ko sur ${Math.round(TAILLE_MAX / 1024)}` : ""}
            </span>
          )}
          {modifie ? <button type="button" className="feBouton" disabled={occupe} onClick={annuler}>Annuler</button> : null}
          <button
            type="button"
            className="feBouton fePrincipal"
            disabled={occupe || (!modifie && !!entreprise) || !String(brouillon.nom || "").trim()}
            onClick={enregistrer}
          >
            {occupe ? "Enregistrement…" : "Enregistrer la fiche"}
          </button>
        </div>
      ) : message ? (
        <span className="feMessage" data-ton={message.ton}>{message.texte}</span>
      ) : null}
    </div>
  );
};
