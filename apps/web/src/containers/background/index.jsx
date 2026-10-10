import React, { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { Icon, Image } from "../../utils/general";
import { api, noterSession } from "../../api/client";
import { syncInstalledModules, detachAllModules } from "../../apps/sync";
import { appliquerApparence, reinitialiserApparence } from "../../apps/appearance";
import { demarrerPreferences } from "../../apps/preferences";
import { resynchroniserNotifications } from "../../apps/notifications";
import { Avatar } from "../../apps/Avatar";
import { useTraduction } from "../../utils/intl";
import { localeEffective } from "../../utils/langue";
import "./back.scss";

const TEXTES = {
  fr: {
    connexionImpossible: "Connexion impossible",
    titreMfa: "Vérification en deux étapes",
    aideMfa: "Saisissez le code à 6 chiffres de votre application d'authentification, ou un code de secours.",
    codeMfa: "Code",
    verifier: "Vérifier",
    retour: "Retour",
    ouvrir: "Ouvrir mon espace",
    changerCompte: "Changer de compte",
    titreLogin: "Connexion à CompanyOS",
    titreRegister: "Créer votre espace de travail",
    titreJoin: "Rejoindre un espace de travail",
    codeInvitation: "Code d'invitation",
    nomEntreprise: "Nom de l'entreprise",
    votreNom: "Votre nom",
    email: "Adresse e-mail",
    motDePasse: "Mot de passe",
    seConnecter: "Se connecter",
    creerEspace: "Créer mon espace",
    rejoindre: "Rejoindre",
    versInscription: "Pas encore de compte ? Créer un espace de travail",
    versConnexion: "Déjà un compte ? Se connecter",
    retourConnexion: "Retour à la connexion",
    jaiUnCode: "On m'a invité — j'ai un code",
    motDePasseMin: "Mot de passe (10 caractères min.)",
    oublie: "Mot de passe oublié ?",
    titreOubli: "Mot de passe oublié",
    aideOubli: "Indiquez l'adresse de votre compte : vous recevrez un lien pour choisir un nouveau mot de passe.",
    envoyerLien: "Envoyer le lien",
    lienEnvoye: "Si un compte existe pour cette adresse, un lien vient d'y être envoyé. Il est valable une heure.",
    titreReinit: "Nouveau mot de passe",
    aideReinit: "10 caractères au moins. Toutes vos sessions ouvertes seront fermées.",
    nouveauMdp: "Nouveau mot de passe",
    confirmerMdp: "Confirmer le mot de passe",
    mdpDifferents: "Les deux mots de passe ne correspondent pas.",
    enregistrerMdp: "Enregistrer",
    mdpChange: "Mot de passe changé. Connectez-vous avec le nouveau.",
    sso: "Authentification unique (SSO)",
    titreSso: "Authentification unique",
    aideSso: "Votre entreprise utilise Microsoft, Google ou un autre fournisseur d'identité : saisissez votre adresse professionnelle.",
    continuer: "Continuer",
  },
  en: {
    connexionImpossible: "Could not sign in",
    titreMfa: "Two-step verification",
    aideMfa: "Enter the 6-digit code from your authenticator app, or a recovery code.",
    codeMfa: "Code",
    verifier: "Verify",
    retour: "Back",
    ouvrir: "Open my workspace",
    changerCompte: "Switch account",
    titreLogin: "Sign in to CompanyOS",
    titreRegister: "Create your workspace",
    titreJoin: "Join a workspace",
    codeInvitation: "Invitation code",
    nomEntreprise: "Company name",
    votreNom: "Your name",
    email: "Email address",
    motDePasse: "Password",
    seConnecter: "Sign in",
    creerEspace: "Create my workspace",
    rejoindre: "Join",
    versInscription: "No account yet? Create a workspace",
    versConnexion: "Already have an account? Sign in",
    retourConnexion: "Back to sign-in",
    jaiUnCode: "I was invited — I have a code",
    motDePasseMin: "Password (10 characters min.)",
    oublie: "Forgot password?",
    titreOubli: "Forgot password",
    aideOubli: "Enter your account's email address: you'll receive a link to choose a new password.",
    envoyerLien: "Send the link",
    lienEnvoye: "If an account exists for this address, a link has just been sent. It's valid for one hour.",
    titreReinit: "New password",
    aideReinit: "At least 10 characters. All your open sessions will be closed.",
    nouveauMdp: "New password",
    confirmerMdp: "Confirm password",
    mdpDifferents: "The two passwords don't match.",
    enregistrerMdp: "Save",
    mdpChange: "Password changed. Sign in with the new one.",
    sso: "Single sign-on (SSO)",
    titreSso: "Single sign-on",
    aideSso: "Your company uses Microsoft, Google or another identity provider: enter your work email.",
    continuer: "Continue",
  },
};

export const Background = () => {
  const wall = useSelector((state) => state.wallpaper);
  // Un fond importé par l'utilisateur prime sur les fonds livrés.
  const perso = useSelector((state) => state.appearance.wallUrl);

  return (
    <div
      className="background"
      style={{
        backgroundImage: perso ? `url(${perso})` : `url(img/wallpaper/${wall.src})`,
      }}
    ></div>
  );
};

export const BootScreen = (props) => {
  const dispatch = useDispatch();
  const wall = useSelector((state) => state.wallpaper);
  const [blackout, setBlackOut] = useState(false);

  useEffect(() => {
    if (props.dir < 0) {
      setTimeout(() => {
        console.log("blackout");
        setBlackOut(true);
      }, 4000);
    }
  }, [props.dir]);

  useEffect(() => {
    if (props.dir < 0) {
      if (blackout) {
        if (wall.act == "restart") {
          setTimeout(() => {
            setBlackOut(false);
            setTimeout(() => {
              dispatch({ type: "WALLBOOTED" });
            }, 4000);
          }, 2000);
        }
      }
    }
  }, [blackout]);

  return (
    <div className="bootscreen">
      <div className={blackout ? "hidden" : ""}>
        <Image src="/img/asset/logo.svg" ext w={180} />
        <div className="mt-48" id="loader">
          <svg className="progressRing" height={48} width={48} viewBox="0 0 16 16">
            <circle cx="8px" cy="8px" r="7px"></circle>
          </svg>
        </div>
      </div>
    </div>
  );
};

export const LockScreen = (props) => {
  const t = useTraduction(TEXTES);
  const session = useSelector((state) => state.session);
  const [lock, setLock] = useState(false);
  const [unlocked, setUnLock] = useState(false);
  // Trois entrées possibles dans CompanyOS :
  //
  //   login    — on a déjà un compte
  //   register — on crée l'entreprise, donc l'espace de travail
  //   join     — on a reçu un code d'invitation et aucun compte
  //
  // Le troisième cas n'est pas un détail : sans lui, inviter quelqu'un
  // ne mène nulle part.
  // Arrivée par un lien : réinitialisation de mot de passe (?reinit=…),
  // invitation (?code=…) ou retour d'authentification unique en échec.
  const [parametres] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const lu = { reinit: p.get("reinit"), code: p.get("code"), erreurSso: p.get("sso_erreur"), ssoOk: p.get("sso") === "ok" };
      if (lu.reinit || lu.code || lu.erreurSso || lu.ssoOk) {
        // Le jeton ne reste pas dans l'adresse (historique, captures d'écran).
        window.history.replaceState(null, "", `${window.location.pathname}?connexion`);
      }
      return lu;
    } catch {
      return {};
    }
  });
  const [mode, setMode] = useState(() =>
    /^[a-f0-9]{32}$/.test(parametres.reinit || "") ? "reinit" : parametres.code ? "join" : "login",
  );
  const [form, setForm] = useState({
    company: "",
    name: "",
    email: "",
    password: "",
    password2: "",
    code: (parametres.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 32),
    otp: "",
  });
  const [info, setInfo] = useState("");
  // Défi rendu par la première étape quand le compte a la double
  // authentification : seul le code le transforme en session.
  const [defi, setDefi] = useState(null);
  const [error, setError] = useState(parametres.erreurSso ? String(parametres.erreurSso).slice(0, 200) : "");
  const [busy, setBusy] = useState(false);
  const dispatch = useDispatch();

  const proceed = () => {
    setUnLock(true);
    setTimeout(() => {
      dispatch({ type: "WALLUNLOCK" });
    }, 1000);
  };

  const field = (key) => (e) => {
    setForm({ ...form, [key]: e.target.value });
    setError("");
  };

  /// La session est ouverte : on installe l'espace et on entre.
  ///
  /// Double authentification exigée mais pas encore configurée : on entre
  /// sans rien charger — l'écran de configuration recouvre le bureau, et la
  /// page repart de zéro une fois la protection activée.
  const terminer = async (result) => {
    dispatch({ type: "SESSION_SET", payload: result });
    dispatch({
      type: "STNGSETV",
      payload: { path: "person.name", value: result.user.name },
    });
    if (!result.mfaAConfigurer) {
      await syncInstalledModules();
      await resynchroniserNotifications();
      await appliquerApparence(result.tenant.id);
      await demarrerPreferences(result.tenant.id);
    }
    proceed();
  };

  // Retour du fournisseur d'identité : la session est déjà ouverte côté
  // serveur (cookie) ; on la reprend sans rien demander.
  useEffect(() => {
    if (!parametres.ssoOk) return;
    let vivant = true;
    (async () => {
      setBusy(true);
      try {
        const moi = await api.me();
        noterSession();
        if (vivant) await terminer(moi);
      } catch (err) {
        if (vivant) setError(err.message || t("connexionImpossible"));
      } finally {
        if (vivant) setBusy(false);
      }
    })();
    return () => {
      vivant = false;
    };
    // Une seule fois, à l'arrivée.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "mfa") {
        await terminer(await api.loginMfa(defi, form.otp));
        setDefi(null);
        return;
      }
      if (mode === "oubli") {
        await api.motDePasseOublie(form.email);
        setInfo(t("lienEnvoye"));
        return;
      }
      if (mode === "reinit") {
        if (form.password !== form.password2) {
          setError(t("mdpDifferents"));
          return;
        }
        await api.reinitialiserMotDePasse(parametres.reinit, form.password);
        setForm((f) => ({ ...f, password: "", password2: "" }));
        setMode("login");
        setInfo(t("mdpChange"));
        return;
      }
      if (mode === "sso") {
        // Le fournisseur d'identité prend la main ; il nous renverra
        // ici, session ouverte.
        window.location.assign(api.urlSso(form.email));
        return;
      }
      const result =
        mode === "login"
          ? await api.login({ email: form.email, password: form.password })
          : mode === "join"
            ? await api.join(form.code, form.name, form.password)
            : await api.register(form);
      if (result.mfa) {
        setDefi(result.defi);
        setForm((f) => ({ ...f, otp: "" }));
        setMode("mfa");
        return;
      }
      await terminer(result);
    } catch (err) {
      setError(err.message || t("connexionImpossible"));
      // Espace en SSO obligatoire : on propose directement le bon chemin.
      if (err.sso) setMode("sso");
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === "Enter") submit();
  };

  /// Les codes sont dictés au téléphone ou recopiés d'un message : on
  /// accepte les minuscules et les espaces plutôt que de renvoyer
  /// « code invalide » pour une majuscule manquante.
  const changerCode = (e) => {
    setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s+/g, "") });
    setError("");
  };

  const changerMode = (suivant) => {
    setMode(suivant);
    setError("");
    setInfo("");
  };

  const authenticated = session.status === "authenticated";

  return (
    <div
      className={"lockscreen " + (props.dir == -1 ? "slowfadein" : "")}
      data-unlock={unlocked}
      style={{
        backgroundImage: `url(${`img/wallpaper/lock.svg`})`,
      }}
      onClick={() => setLock(true)}
      data-blur={lock}
    >
      <div className="splashScreen mt-40" data-faded={lock}>
        <div className="text-6xl font-semibold text-gray-100">
          {new Date().toLocaleTimeString(localeEffective(), {
            hour: "numeric",
            minute: "numeric",
          })}
        </div>
        <div className="text-lg font-medium text-gray-200">
          {new Date().toLocaleDateString(localeEffective(), {
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>
      <div
        className="fadeinScreen"
        data-faded={!lock}
        data-unlock={unlocked}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Avant la connexion, on ne sait pas qui est là : un rond neutre
            plutôt que la photo de la dernière personne connectée. */}
        <Avatar
          nom={authenticated ? session.user.name : ""}
          photo={authenticated ? session.user.avatar : null}
          taille={120}
        />
        {authenticated ? (
          <>
            <div className="mt-2 text-2xl font-medium text-gray-200">
              {session.user.name}
            </div>
            <div className="text-xs text-gray-400 mt-1">{session.tenant.name}</div>
            <div className="flex items-center mt-6 signInBtn" onClick={proceed}>
              {t("ouvrir")}
            </div>
            <div
              className="text-xs text-gray-400 mt-4 handcr"
              onClick={() => {
                api.logout().catch(() => {});
                dispatch({ type: "SESSION_CLEAR" });
                detachAllModules();
                reinitialiserApparence();
                resynchroniserNotifications();
              }}
            >
              {t("changerCompte")}
            </div>
          </>
        ) : (
          mode === "oubli" || mode === "reinit" || mode === "sso" ? (
          <div className="authForm mt-4">
            <div className="text-xl font-medium text-gray-200 mb-1">
              {{ oubli: t("titreOubli"), reinit: t("titreReinit"), sso: t("titreSso") }[mode]}
            </div>
            <div className="text-xs text-gray-300 mb-2 authAide">
              {{ oubli: t("aideOubli"), reinit: t("aideReinit"), sso: t("aideSso") }[mode]}
            </div>
            {mode === "reinit" ? (
              <>
                <input type="password" autoComplete="new-password" placeholder={t("nouveauMdp")} value={form.password} onChange={field("password")} onKeyDown={onKey} autoFocus />
                <input type="password" autoComplete="new-password" placeholder={t("confirmerMdp")} value={form.password2} onChange={field("password2")} onKeyDown={onKey} />
              </>
            ) : (
              <input type="email" autoComplete="email" placeholder={t("email")} value={form.email} onChange={field("email")} onKeyDown={onKey} autoFocus />
            )}
            {error ? <div className="authError">{error}</div> : null}
            {info ? <div className="authInfo">{info}</div> : null}
            {!info || mode !== "oubli" ? (
              <div className="flex items-center mt-4 signInBtn" onClick={submit}>
                {busy ? "…" : { oubli: t("envoyerLien"), reinit: t("enregistrerMdp"), sso: t("continuer") }[mode]}
              </div>
            ) : null}
            <div className="text-xs text-gray-400 mt-4 handcr" onClick={() => changerMode("login")}>
              {t("retourConnexion")}
            </div>
          </div>
          ) : mode === "mfa" ? (
          <div className="authForm mt-4">
            <div className="text-xl font-medium text-gray-200 mb-1">{t("titreMfa")}</div>
            <div className="text-xs text-gray-300 mb-3 authAide">{t("aideMfa")}</div>
            <input
              type="text"
              className="authCode"
              inputMode="text"
              autoComplete="one-time-code"
              placeholder={t("codeMfa")}
              value={form.otp}
              maxLength={12}
              onChange={(e) => {
                setForm({ ...form, otp: e.target.value.replace(/[^0-9A-Za-z-]/g, "").toUpperCase() });
                setError("");
              }}
              onKeyDown={onKey}
              autoFocus
            />
            {error ? <div className="authError">{error}</div> : null}
            <div className="flex items-center mt-4 signInBtn" onClick={submit}>
              {busy ? "…" : t("verifier")}
            </div>
            <div
              className="text-xs text-gray-400 mt-4 handcr"
              onClick={() => {
                setDefi(null);
                changerMode("login");
              }}
            >
              {t("retour")}
            </div>
          </div>
          ) : (
          <div className="authForm mt-4">
            <div className="text-xl font-medium text-gray-200 mb-3">
              {
                {
                  login: t("titreLogin"),
                  register: t("titreRegister"),
                  join: t("titreJoin"),
                }[mode]
              }
            </div>
            {mode === "join" && (
              // L'adresse n'est pas demandée : elle est déjà inscrite dans
              // l'invitation. La saisir permettrait de rejoindre sous une
              // autre identité que celle invitée.
              <input
                type="text"
                className="authCode"
                placeholder={t("codeInvitation")}
                value={form.code}
                onChange={changerCode}
                onKeyDown={onKey}
                autoFocus
              />
            )}
            {mode !== "login" && (
              <>
                {mode === "register" && (
                  <input
                    type="text"
                    placeholder={t("nomEntreprise")}
                    value={form.company}
                    onChange={field("company")}
                    onKeyDown={onKey}
                  />
                )}
                <input
                  type="text"
                  placeholder={t("votreNom")}
                  value={form.name}
                  onChange={field("name")}
                  onKeyDown={onKey}
                />
              </>
            )}
            {mode !== "join" && (
              <input
                type="email"
                placeholder={t("email")}
                value={form.email}
                onChange={field("email")}
                onKeyDown={onKey}
                autoFocus
              />
            )}
            <input
              type="password"
              placeholder={mode === "login" ? t("motDePasse") : t("motDePasseMin")}
              value={form.password}
              onChange={field("password")}
              onKeyDown={onKey}
            />
            {mode === "login" ? (
              <div className="text-xs text-gray-400 mt-2 handcr authOubli" onClick={() => changerMode("oubli")}>
                {t("oublie")}
              </div>
            ) : null}
            {error ? <div className="authError">{error}</div> : null}
            {info ? <div className="authInfo">{info}</div> : null}
            <div className="flex items-center mt-4 signInBtn" onClick={submit}>
              {busy
                ? "…"
                : {
                    login: t("seConnecter"),
                    register: t("creerEspace"),
                    join: t("rejoindre"),
                  }[mode]}
            </div>
            {mode === "login" ? (
              <div className="flex items-center mt-2 signInBtn authSso" onClick={() => changerMode("sso")}>
                {t("sso")}
              </div>
            ) : null}
            <div
              className="text-xs text-gray-400 mt-4 handcr"
              onClick={() => changerMode(mode === "login" ? "register" : "login")}
            >
              {mode === "login" ? t("versInscription") : t("versConnexion")}
            </div>
            <div
              className="text-xs text-gray-400 mt-2 handcr"
              onClick={() => changerMode(mode === "join" ? "login" : "join")}
            >
              {mode === "join" ? t("retourConnexion") : t("jaiUnCode")}
            </div>
          </div>
          )
        )}
      </div>
      <div className="bottomInfo flex">
        <span className="lockBrand">CompanyOS</span>
      </div>
    </div>
  );
};
