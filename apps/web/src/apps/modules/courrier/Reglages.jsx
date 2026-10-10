import React, { useEffect, useRef, useState } from "react";
import { api } from "../../../api/client";
import { Icon } from "../../../utils/general";
import { modal } from "../../modalRequest";
import { notifier } from "../../notifications";
import { Bouton, Champ, Notice } from "../../ui";
import * as D from "@companyos/shared/courrier";
import { quand } from "./outils";

// Réglages du Courrier : les boîtes reliées (IMAP pour recevoir, SMTP
// facultatif pour répondre sous cette adresse), le relais d'envoi de
// l'entreprise, les relances de factures et les modèles.

const FOURNISSEURS = [
  { id: "", libelle: "Autre fournisseur" },
  { id: "gmail", libelle: "Gmail / Google Workspace", imap: "imap.gmail.com", smtp: "smtp.gmail.com", aide: "Créez un mot de passe d'application (compte Google › Sécurité)." },
  { id: "outlook", libelle: "Microsoft 365 / Outlook", imap: "outlook.office365.com", smtp: "smtp.office365.com", aide: "Activez l'accès IMAP dans le centre d'administration Exchange." },
  { id: "ovh", libelle: "OVHcloud", imap: "ssl0.ovh.net", smtp: "ssl0.ovh.net" },
  { id: "zoho", libelle: "Zoho Mail", imap: "imap.zoho.eu", smtp: "smtp.zoho.eu" },
];

const VIDE = { nom: "", adresse: "", partagee: false, imap: { host: "", port: 993, user: "", pass: "" }, avecSmtp: false, smtp: { host: "", port: 587, user: "", pass: "" }, signature: "", actif: true };

const FormBoite = ({ boite, admin, onFin }) => {
  const [v, setV] = useState(() =>
    boite
      ? {
          ...VIDE,
          ...boite,
          imap: { ...VIDE.imap, ...boite.imap, pass: "" },
          avecSmtp: !!boite.smtp,
          smtp: { ...VIDE.smtp, ...(boite.smtp || {}), pass: "" },
        }
      : VIDE,
  );
  const [fournisseur, setFournisseur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const [test, setTest] = useState(null);
  const maj = (patch) => setV((x) => ({ ...x, ...patch }));
  const majImap = (patch) => setV((x) => ({ ...x, imap: { ...x.imap, ...patch } }));
  const majSmtp = (patch) => setV((x) => ({ ...x, smtp: { ...x.smtp, ...patch } }));
  const f = FOURNISSEURS.find((x) => x.id === fournisseur);

  const choisirFournisseur = (id) => {
    setFournisseur(id);
    const x = FOURNISSEURS.find((y) => y.id === id);
    if (x?.imap) {
      majImap({ host: x.imap, port: 993, user: v.imap.user || v.adresse });
      setV((y) => ({ ...y, avecSmtp: true, smtp: { ...y.smtp, host: x.smtp, port: 587, user: y.smtp.user || y.adresse } }));
    }
  };

  const tester = async () => {
    setTest({ en: true });
    try {
      const r = await api.messagerie.tester({ ...v.imap, boiteId: boite?.id });
      setTest({ ok: true, texte: `Connexion réussie — ${r.messages} message${r.messages > 1 ? "s" : ""} dans la boîte, ${r.nonLus} non lu${r.nonLus > 1 ? "s" : ""}.` });
    } catch (e) {
      setTest({ ok: false, texte: e.message });
    }
  };

  const enregistrer = async () => {
    setOccupe(true);
    try {
      const corps = {
        nom: v.nom.trim() || v.adresse,
        adresse: v.adresse.trim(),
        partagee: v.partagee,
        imap: { ...v.imap, port: Number(v.imap.port), user: v.imap.user || v.adresse },
        smtp: v.avecSmtp ? { ...v.smtp, port: Number(v.smtp.port), user: v.smtp.user || v.adresse } : null,
        signature: v.signature,
        actif: v.actif,
      };
      if (boite) await api.messagerie.modifierBoite(boite.id, corps);
      else await api.messagerie.creerBoite(corps);
      notifier({ titre: boite ? "Boîte mise à jour" : "Boîte reliée — première relève en cours", message: corps.adresse, app: "Courrier", ton: "success" });
      onFin(true);
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    } finally {
      setOccupe(false);
    }
  };

  return (
    <div className="crrFormBoite">
      {!boite ? (
        <Champ label="Fournisseur">
          <select value={fournisseur} onChange={(e) => choisirFournisseur(e.target.value)}>
            {FOURNISSEURS.map((x) => (
              <option key={x.id} value={x.id}>
                {x.libelle}
              </option>
            ))}
          </select>
        </Champ>
      ) : null}
      {f?.aide ? <Notice>{f.aide}</Notice> : null}
      <div className="crrGrille">
        <Champ label="Adresse">
          <input value={v.adresse} placeholder="contact@entreprise.ci" onChange={(e) => maj({ adresse: e.target.value })} />
        </Champ>
        <Champ label="Nom affiché">
          <input value={v.nom} placeholder="Service commercial" onChange={(e) => maj({ nom: e.target.value })} />
        </Champ>
      </div>
      {!boite && admin ? (
        <label className="crrBascule">
          <input type="checkbox" checked={v.partagee} onChange={(e) => maj({ partagee: e.target.checked })} />
          <span>Boîte partagée — lisible par toute l'équipe (contact@, compta@…)</span>
        </label>
      ) : null}

      <h4 className="crrSousTitre">Réception (IMAP)</h4>
      <div className="crrGrille">
        <Champ label="Serveur IMAP">
          <input value={v.imap.host} placeholder="imap.entreprise.ci" onChange={(e) => majImap({ host: e.target.value })} />
        </Champ>
        <Champ label="Port" aide="993 (TLS) ou 143 (STARTTLS)">
          <select value={v.imap.port} onChange={(e) => majImap({ port: Number(e.target.value) })}>
            <option value={993}>993</option>
            <option value={143}>143</option>
          </select>
        </Champ>
        <Champ label="Identifiant">
          <input value={v.imap.user} placeholder={v.adresse || "identifiant"} onChange={(e) => majImap({ user: e.target.value })} />
        </Champ>
        <Champ label="Mot de passe" aide={boite?.imap?.motDePasseDefini ? "Défini — laissez vide pour le conserver" : "Mot de passe ou mot de passe d'application"}>
          <input type="password" value={v.imap.pass} placeholder={boite?.imap?.motDePasseDefini ? "••••••••" : ""} onChange={(e) => majImap({ pass: e.target.value })} />
        </Champ>
      </div>
      <div className="crrTest">
        <Bouton variante="secondaire" icone="faPlug" off={!v.imap.host || test?.en} onClick={tester}>
          {test?.en ? "Test…" : "Tester la connexion"}
        </Bouton>
        {test && !test.en ? <span data-ok={test.ok}>{test.texte}</span> : null}
      </div>

      <label className="crrBascule">
        <input type="checkbox" checked={v.avecSmtp} onChange={(e) => maj({ avecSmtp: e.target.checked })} />
        <span>Envoyer sous cette adresse (SMTP propre à la boîte)</span>
      </label>
      {v.avecSmtp ? (
        <div className="crrGrille">
          <Champ label="Serveur SMTP">
            <input value={v.smtp.host} placeholder="smtp.entreprise.ci" onChange={(e) => majSmtp({ host: e.target.value })} />
          </Champ>
          <Champ label="Port">
            <select value={v.smtp.port} onChange={(e) => majSmtp({ port: Number(e.target.value) })}>
              {[587, 465, 2525, 25].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Champ>
          <Champ label="Identifiant">
            <input value={v.smtp.user} placeholder={v.adresse} onChange={(e) => majSmtp({ user: e.target.value })} />
          </Champ>
          <Champ label="Mot de passe" aide={boite?.smtp?.motDePasseDefini ? "Défini — laissez vide pour le conserver" : ""}>
            <input type="password" value={v.smtp.pass} placeholder={boite?.smtp?.motDePasseDefini ? "••••••••" : ""} onChange={(e) => majSmtp({ pass: e.target.value })} />
          </Champ>
        </div>
      ) : (
        <p className="crrAide">Sans SMTP propre, les réponses partent par le relais de l'entreprise, avec cette adresse en « Répondre à ».</p>
      )}

      <Champ label="Signature" aide="Ajoutée aux nouveaux messages envoyés depuis cette boîte">
        <textarea rows={3} value={v.signature} placeholder={"Awa Koné\nResponsable commerciale — Konan SARL\n+225 07 00 00 00"} onChange={(e) => maj({ signature: e.target.value })} />
      </Champ>
      {boite ? (
        <label className="crrBascule">
          <input type="checkbox" checked={v.actif} onChange={(e) => maj({ actif: e.target.checked })} />
          <span>Relever cette boîte automatiquement (toutes les 2 minutes)</span>
        </label>
      ) : null}

      <div className="crrBarreCommandes">
        <Bouton icone="faFloppyDisk" off={occupe || !D.adresseValide(v.adresse) || !v.imap.host} onClick={enregistrer}>
          {boite ? "Enregistrer" : "Relier la boîte"}
        </Bouton>
        <Bouton variante="secondaire" onClick={() => onFin(false)}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
};

const ModeleEditeur = ({ fiche, onFin }) => {
  const [nom, setNom] = useState(fiche?.data.nom || "");
  const [sujet, setSujet] = useState(fiche?.data.sujet || "");
  const [texte, setTexte] = useState(fiche?.data.texte || "");
  const zone = useRef(null);
  const inserer = (v) => {
    const el = zone.current;
    const jeton = `{{${v}}}`;
    if (!el) return setTexte((t) => t + jeton);
    const debut = el.selectionStart ?? texte.length;
    setTexte(texte.slice(0, debut) + jeton + texte.slice(el.selectionEnd ?? debut));
  };
  const enregistrer = async () => {
    try {
      const d = { nom: nom.trim(), sujet: sujet.trim(), texte };
      if (fiche) await api.records.update("courrier", "modeles", fiche.id, d);
      else await api.records.create("courrier", "modeles", d);
      onFin(true);
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    }
  };
  return (
    <div className="crrFormBoite">
      <div className="crrGrille">
        <Champ label="Nom">
          <input value={nom} autoFocus placeholder="Relance de facture, Envoi de devis…" onChange={(e) => setNom(e.target.value)} />
        </Champ>
        <Champ label="Objet">
          <input value={sujet} placeholder="Rappel — facture {{numero}}" onChange={(e) => setSujet(e.target.value)} />
        </Champ>
      </div>
      <div className="crrVariables">
        {D.VARIABLES_MODELES.map((v) => (
          <button type="button" key={v.nom} className="crrVariable" title={v.exemple} onClick={() => inserer(v.nom)}>
            {`{{${v.nom}}}`}
          </button>
        ))}
      </div>
      <textarea ref={zone} className="crrModeleTexte" rows={8} value={texte} placeholder={"Bonjour {{client}},\n\n…"} onChange={(e) => setTexte(e.target.value)} />
      <div className="crrBarreCommandes">
        <Bouton icone="faFloppyDisk" off={!nom.trim() || !sujet.trim() || !texte.trim()} onClick={enregistrer}>
          Enregistrer le modèle
        </Bouton>
        <Bouton variante="secondaire" onClick={() => onFin(false)}>
          Annuler
        </Bouton>
      </div>
    </div>
  );
};

export const Reglages = ({ boites, modeles, estAdmin, onRecharger, telephone, onRetour }) => {
  const [edition, setEdition] = useState(null); // { type: "boite"|"modele", fiche }
  const [relais, setRelais] = useState(null);
  const [occupe, setOccupe] = useState(null);

  useEffect(() => {
    if (estAdmin) api.courrierReglages().then(setRelais).catch(() => setRelais({}));
  }, [estAdmin]);

  const fin = async (change) => {
    setEdition(null);
    if (change) await onRecharger();
  };

  const relever = async (b) => {
    setOccupe(b.id);
    try {
      const r = await api.messagerie.synchroniser(b.id);
      notifier({ titre: r.enCours ? "Relève déjà en cours" : `${r.nouveaux || 0} nouveau(x) courriel(s)`, message: b.adresse, app: "Courrier", ton: "success" });
      await onRecharger();
    } catch (e) {
      modal.alert({ title: "Relève impossible", message: e.message, tone: "error" });
      await onRecharger();
    } finally {
      setOccupe(null);
    }
  };

  const supprimer = async (b) => {
    const ok = await modal.confirm({
      title: `Retirer ${b.adresse} ?`,
      message: "Les courriels relevés depuis cette boîte seront retirés de CompanyOS. Ils restent sur le serveur de messagerie ; leurs pièces jointes restent dans le Cloud.",
      confirmLabel: "Retirer la boîte",
      danger: true,
    });
    if (!ok) return;
    await api.messagerie.supprimerBoite(b.id);
    await onRecharger();
  };

  const supprimerModele = async (m) => {
    const ok = await modal.confirm({ title: "Supprimer ce modèle ?", message: `« ${m.data.nom} » ne sera plus proposé.`, confirmLabel: "Supprimer", danger: true });
    if (!ok) return;
    await api.records.remove("courrier", "modeles", m.id);
    await onRecharger();
  };

  const enregistrerRelais = async () => {
    try {
      await api.courrierEnregistrerReglages({
        host: relais.host || "",
        port: Number(relais.port) || 587,
        user: relais.user || "",
        pass: relais.pass || "",
        de: relais.de || "",
        relances: {
          actif: Boolean(relais.relances?.actif),
          paliers: String(relais.relances?.paliersTexte ?? (relais.relances?.paliers || []).join(", "))
            .split(/[,;]/)
            .map((n) => parseInt(n, 10))
            .filter((n) => n > 0),
          modeleId: relais.relances?.modeleId || "",
        },
      });
      setRelais(await api.courrierReglages());
      notifier({ titre: "Réglages d'envoi enregistrés", app: "Courrier", ton: "success" });
    } catch (e) {
      modal.alert({ title: "Enregistrement impossible", message: e.message, tone: "error" });
    }
  };

  return (
    <div className="crrReglages cosScroll">
      <div className="crrReglagesTete">
        {telephone ? (
          <button type="button" className="crrIconeBtn" aria-label="Retour" onClick={onRetour}>
            <Icon fafa="faArrowLeft" width={13} />
          </button>
        ) : null}
        <h2>Réglages du Courrier</h2>
      </div>

      <section className="crrCarte">
        <div className="crrCarteTete">
          <div>
            <h3>Boîtes de messagerie</h3>
            <p className="crrAide">Reliez vos adresses pour recevoir, classer et répondre depuis CompanyOS. Les messages sont relevés toutes les 2 minutes.</p>
          </div>
          {!edition ? (
            <Bouton icone="faPlus" onClick={() => setEdition({ type: "boite", fiche: null })}>
              Relier une boîte
            </Bouton>
          ) : null}
        </div>
        {edition?.type === "boite" ? <FormBoite boite={edition.fiche} admin={estAdmin} onFin={fin} /> : null}
        {!boites.length && !edition ? <div className="crrVideCarte">Aucune boîte reliée. Les messages partent par le relais de l'entreprise ; reliez une boîte pour recevoir.</div> : null}
        <div className="crrListeBoites">
          {boites.map((b) => (
            <div key={b.id} className="crrLigneBoite" data-erreur={!!b.erreur}>
              <span className="crrPastilleEtat" data-ton={b.erreur ? "erreur" : b.actif ? "ok" : "pause"} />
              <div className="crrLigneBoiteTexte">
                <strong>
                  {b.nom} <span className="crrBadge">{b.partagee ? "Partagée" : "Personnelle"}</span>
                </strong>
                <small>
                  {b.adresse} · {b.erreur ? b.erreur : b.derniereSynchro ? `relevée ${quand(b.derniereSynchro)}` : "première relève en attente"}
                </small>
              </div>
              {b.mienne || (b.partagee && estAdmin) ? (
                <span className="crrLigneBoiteActions">
                  <button type="button" className="crrIconeBtn" title="Relever maintenant" disabled={occupe === b.id} onClick={() => relever(b)}>
                    <Icon fafa="faRotate" width={12} />
                  </button>
                  <button type="button" className="crrIconeBtn" title="Modifier" onClick={() => setEdition({ type: "boite", fiche: b })}>
                    <Icon fafa="faPen" width={12} />
                  </button>
                  <button type="button" className="crrIconeBtn" title="Retirer" onClick={() => supprimer(b)}>
                    <Icon fafa="faTrashCan" width={12} />
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="crrCarte">
        <div className="crrCarteTete">
          <div>
            <h3>Modèles de messages</h3>
            <p className="crrAide">Relances, devis, confirmations… insérés en un clic dans le composeur, et utilisés par les relances automatiques.</p>
          </div>
          {!edition ? (
            <Bouton variante="secondaire" icone="faPlus" onClick={() => setEdition({ type: "modele", fiche: null })}>
              Nouveau modèle
            </Bouton>
          ) : null}
        </div>
        {edition?.type === "modele" ? <ModeleEditeur fiche={edition.fiche} onFin={fin} /> : null}
        <div className="crrListeBoites">
          {modeles.map((m) => (
            <div key={m.id} className="crrLigneBoite">
              <Icon fafa="faClone" width={13} />
              <div className="crrLigneBoiteTexte">
                <strong>{m.data.nom}</strong>
                <small>{m.data.sujet}</small>
              </div>
              <span className="crrLigneBoiteActions">
                <button type="button" className="crrIconeBtn" title="Modifier" onClick={() => setEdition({ type: "modele", fiche: m })}>
                  <Icon fafa="faPen" width={12} />
                </button>
                <button type="button" className="crrIconeBtn" title="Supprimer" onClick={() => supprimerModele(m)}>
                  <Icon fafa="faTrashCan" width={12} />
                </button>
              </span>
            </div>
          ))}
        </div>
      </section>

      {estAdmin && relais ? (
        <section className="crrCarte">
          <div className="crrCarteTete">
            <div>
              <h3>Relais d'envoi de l'entreprise</h3>
              <p className="crrAide">
                Le serveur SMTP par lequel partent les messages sans boîte dédiée (factures, relances, envois des autres applications).
                {relais.relaisPlateforme ? " Sans réglage, le relais de la plateforme prend le relais." : " Sans réglage, aucun envoi ne peut partir."}
              </p>
            </div>
          </div>
          <div className="crrGrille">
            <Champ label="Serveur SMTP">
              <input value={relais.host || ""} placeholder="smtp-relay.brevo.com" onChange={(e) => setRelais({ ...relais, host: e.target.value })} />
            </Champ>
            <Champ label="Port" aide="587 (STARTTLS) ou 465 (TLS)">
              <input type="number" value={relais.port || 587} onChange={(e) => setRelais({ ...relais, port: e.target.value })} />
            </Champ>
            <Champ label="Identifiant">
              <input value={relais.user || ""} onChange={(e) => setRelais({ ...relais, user: e.target.value })} />
            </Champ>
            <Champ label="Mot de passe / clé SMTP" aide={relais.motDePasseDefini ? "Défini — laissez vide pour le conserver" : "À renseigner"}>
              <input type="password" value={relais.pass || ""} placeholder={relais.motDePasseDefini ? "••••••••" : ""} onChange={(e) => setRelais({ ...relais, pass: e.target.value })} />
            </Champ>
            <Champ label="Expéditeur" aide="Ce que verront vos destinataires">
              <input value={relais.de || ""} placeholder="Konan SARL <contact@konan.ci>" onChange={(e) => setRelais({ ...relais, de: e.target.value })} />
            </Champ>
          </div>
          <h4 className="crrSousTitre">Relances de factures</h4>
          <label className="crrBascule">
            <input type="checkbox" checked={Boolean(relais.relances?.actif)} onChange={(e) => setRelais({ ...relais, relances: { ...relais.relances, actif: e.target.checked } })} />
            <span>Relancer automatiquement les factures impayées</span>
          </label>
          {relais.relances?.actif ? (
            <div className="crrGrille">
              <Champ label="Paliers (jours après l'échéance)" aide="Séparés par des virgules">
                <input
                  value={relais.relances?.paliersTexte ?? (relais.relances?.paliers || [7, 15, 30]).join(", ")}
                  onChange={(e) => setRelais({ ...relais, relances: { ...relais.relances, paliersTexte: e.target.value } })}
                />
              </Champ>
              <Champ label="Modèle du message">
                <select value={relais.relances?.modeleId || ""} onChange={(e) => setRelais({ ...relais, relances: { ...relais.relances, modeleId: e.target.value } })}>
                  <option value="">Message par défaut</option>
                  {modeles.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.data.nom}
                    </option>
                  ))}
                </select>
              </Champ>
            </div>
          ) : null}
          <div className="crrBarreCommandes">
            <Bouton icone="faFloppyDisk" onClick={enregistrerRelais}>
              Enregistrer
            </Bouton>
          </div>
        </section>
      ) : null}
    </div>
  );
};
