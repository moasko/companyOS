import i18n from "i18next";
import { initReactI18next } from "react-i18next";
// `i18next-http-backend` remplace `i18next-xhr-backend`, abandonné par ses
// auteurs depuis 2020 : même rôle (charger les JSON de traduction), API
// d'options identique pour notre usage.
import Backend from "i18next-http-backend";
import LanguageDetector from "i18next-browser-languagedetector";

// Le shell historique de CompanyOS est écrit en français, directement dans
// les composants : i18next ne le traduit pas encore. Mais la langue résolue
// est désormais réelle : « fr » ou « en », choisie par le réglage
// « Langue et région » (clé locale `companyos-langue`, voir
// src/utils/langue.js) ou détectée depuis le navigateur. Les surfaces
// traduites — le module Présentations, qui enregistre ses bundles par
// langue (voir src/apps/modules/presentation/Editeur.jsx), et les chaînes
// extraites au fil de l'eau vers `locales/<lng>/translate.json` — suivent
// ce choix. Les deux `translate.json` sont vides et n'existent que pour
// éviter un 404 du backend.
const fallbackLng = ["fr"];
const availableLanguages = ["fr", "en"];

// Un choix épinglé dans les réglages prime sur la détection du navigateur.
const langueEpinglee = localStorage.getItem("companyos-langue");

i18n
  .use(Backend) // load translations using http (default public/assets/locals/en/translations)
  .use(LanguageDetector) // detect user language
  .use(initReactI18next) // pass the i18n instance to react-i18next.
  .init({
    lng: langueEpinglee || undefined, // undefined → détection navigateur
    fallbackLng,

    backend: {
      loadPath: "locales/{{lng}}/translate.json",
    },

    debug: false,

    // `whitelist` / `checkWhitelist` sont les noms d'avant i18next 20 :
    // silencieusement ignorés en 21, d'où la requête « fr » malgré la
    // liste. Ce sont désormais `supportedLngs` / `nonExplicitSupportedLngs`.
    supportedLngs: availableLanguages,
    nonExplicitSupportedLngs: true,

    // `languageOnly` retire la région de la langue détectée. Sans lui,
    // un navigateur réglé sur « en-US » réclame d'abord
    // `locales/en-US/translate.json` — qui n'existe pas — et encaisse un 404
    // avant de se rabattre sur « en ». Le repli fonctionne, mais l'erreur
    // reste dans la console à chaque démarrage.
    load: "languageOnly",

    interpolation: {
      escapeValue: false, // no need for react. it escapes by default
    },
  });

export default i18n;
