import React, { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "../../api/client";
import "./securite.scss";

/// Télécharge les codes de secours en .txt — à ranger hors de l'ordinateur.
const telechargerCodes = (codes, email) => {
  const texte = [
    "CompanyOS — codes de secours de la double authentification",
    email ? `Compte : ${email}` : "",
    `Générés le ${new Date().toLocaleString()}`,
    "",
    "Chaque code ne sert qu'une fois. Gardez-les hors de cet ordinateur.",
    "",
    ...codes,
    "",
  ].join("\n");
  const url = URL.createObjectURL(new Blob([texte], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "companyos-codes-de-secours.txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/// Les codes de secours, affichés une seule fois.
export const CodesSecours = ({ codes, email, onTermine, libelleFin = "J'ai mis mes codes en lieu sûr" }) => (
  <div className="mfaCodes">
    <p className="mfaAide">
      Si vous perdez votre téléphone, ces codes vous permettront de vous connecter. Chacun
      ne sert qu'une fois, et ils ne seront <strong>plus jamais affichés</strong>.
    </p>
    <ol className="mfaListeCodes">
      {codes.map((c) => (
        <li key={c}>
          <code>{c}</code>
        </li>
      ))}
    </ol>
    <div className="mfaActions">
      <button type="button" className="mfaBtn mfaBtnGhost" onClick={() => telechargerCodes(codes, email)}>
        Télécharger (.txt)
      </button>
      <button
        type="button"
        className="mfaBtn mfaBtnGhost"
        onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => {})}
      >
        Copier
      </button>
      {onTermine ? (
        <button type="button" className="mfaBtn" onClick={onTermine}>
          {libelleFin}
        </button>
      ) : null}
    </div>
  </div>
);

/// Activation de la double authentification, en trois temps : scanner le
/// QR code, saisir un premier code, noter les codes de secours.
export const ConfigurationMfa = ({ email, onActive, onTermine }) => {
  const [etape, setEtape] = useState("preparation");
  const [secret, setSecret] = useState(null);
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState([]);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let actif = true;
    api
      .mfaPreparer()
      .then(async (r) => {
        if (!actif) return;
        setSecret(r.secret);
        setQr(await QRCode.toDataURL(r.uri, { margin: 1, width: 220, errorCorrectionLevel: "M" }));
        setEtape("scan");
      })
      .catch((e) => actif && setErreur(e.message));
    return () => {
      actif = false;
    };
  }, []);

  const valider = async () => {
    if (occupe) return;
    setOccupe(true);
    setErreur("");
    try {
      const r = await api.mfaActiver(code);
      setCodes(r.codesSecours);
      setEtape("codes");
      onActive?.();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  if (etape === "codes") {
    return <CodesSecours codes={codes} email={email} onTermine={onTermine} />;
  }

  return (
    <div className="mfaConfig">
      {etape === "preparation" ? (
        <p className="mfaAide">{erreur || "Préparation…"}</p>
      ) : (
        <>
          <ol className="mfaEtapes">
            <li>
              Ouvrez votre application d'authentification (Google Authenticator, Microsoft
              Authenticator, 1Password…) et scannez ce code.
            </li>
            <li>Saisissez le code à 6 chiffres qu'elle affiche.</li>
          </ol>
          <div className="mfaScan">
            {qr ? <img src={qr} alt="QR code de configuration" width={180} height={180} /> : null}
            <div className="mfaSecret">
              <span>Impossible de scanner ? Saisissez cette clé :</span>
              <code>{secret?.replace(/(.{4})/g, "$1 ").trim()}</code>
            </div>
          </div>
          <div className="mfaSaisie">
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                setErreur("");
              }}
              onKeyDown={(e) => e.key === "Enter" && code.length === 6 && valider()}
              autoFocus
            />
            <button type="button" className="mfaBtn" disabled={code.length !== 6 || occupe} onClick={valider}>
              {occupe ? "…" : "Activer"}
            </button>
          </div>
          {erreur ? <div className="mfaErreur">{erreur}</div> : null}
        </>
      )}
    </div>
  );
};
