import type { MessageBoxOptions } from "electron";
import type { AppLanguage } from "../shared/types";

export function getSupportBundleExportDialogOptions(language: AppLanguage): MessageBoxOptions {
  const german = language === "de";
  return {
    type: "question",
    title: german ? "Support-Bundle exportieren" : "Export support bundle",
    message: german ? "Diagnoseumfang auswählen" : "Select diagnostic contents",
    detail: german
      ? "Das Bundle enthält Protokolle und eine Übersicht tatsächlicher Archiv-Passwortversuche. Passwortwerte sind standardmäßig ausgeblendet. Mit der folgenden Option werden verfügbare, tatsächlich versuchte Archivpasswörter im Klartext in die ZIP-Datei aufgenommen. Die Datei dann nur an vertrauenswürdige Empfänger weitergeben. API-Schlüssel und Kontopasswörter werden dadurch nicht hinzugefügt."
      : "The bundle includes logs and a record of actual archive password attempts. Password values are hidden by default. The option below adds available archive passwords that were actually attempted to the ZIP file in plain text. Only share that file with trusted recipients. This does not add API keys or account passwords.",
    checkboxLabel: german ? "Versuchte Archivpasswörter im Klartext einschließen" : "Include attempted archive passwords in plain text",
    checkboxChecked: false,
    buttons: german ? ["Exportieren", "Abbrechen"] : ["Export", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  };
}
