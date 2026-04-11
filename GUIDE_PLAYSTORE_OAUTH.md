# 🚀 Guide — Play Store + Google Drive pour AsthmeTrack

---

## Vue d'ensemble

```
1. Google Cloud     → Créer Client ID Android (gratuit)
2. Capacitor        → Configurer le deep link OAuth
3. Play Store       → Publier l'app (25 $ une fois)
4. index.html       → Coller le Client ID (1 ligne)
```

L'utilisateur final n'a qu'à appuyer sur **"Se connecter avec Google"** → popup Google standard → terminé.

---

## Partie 1 — Google Cloud (gratuit, ~10 min)

### 1.1 Créer le projet

1. Aller sur https://console.cloud.google.com
2. Cliquer sur le sélecteur de projet (en haut) → **Nouveau projet**
3. Nom : `AsthmeTrack` → **Créer**

### 1.2 Activer l'API Google Drive

1. Menu → **APIs et services** → **Bibliothèque**
2. Chercher `Google Drive API` → cliquer → **Activer**

### 1.3 Configurer l'écran de consentement OAuth

1. Menu → **APIs et services** → **Écran de consentement OAuth**
2. Type d'utilisateur : **Externe** → **Créer**
3. Remplir :
   - Nom de l'application : `AsthmeTrack`
   - E-mail d'assistance : votre email
   - Logo : optionnel
4. **Enregistrer et continuer**
5. Étape "Champs d'application" → **Ajouter ou supprimer des champs** → chercher `drive.appdata` → cocher → **Mettre à jour**
6. Continuer jusqu'à la fin

### 1.4 Créer le Client ID Android

1. Menu → **APIs et services** → **Identifiants**
2. **Créer des identifiants** → **ID client OAuth 2.0**
3. Type d'application : **Android**
4. Remplir :
   - Nom du package : `com.asthmetrack.app`
   - Empreinte SHA-1 : voir section 1.5 ci-dessous
5. **Créer**
6. **Copier le Client ID** (format : `123456789-xxxx.apps.googleusercontent.com`)

### 1.5 Obtenir l'empreinte SHA-1

Dans un terminal, sur votre PC de build :

```bash
# Si vous utilisez le keystore de debug (pour les tests)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android

# Pour un keystore de release (production)
keytool -list -v -keystore votre-keystore.jks -alias votre-alias
```

Copier la ligne `SHA1:` et la coller dans Google Cloud.

> ⚠️ Le SHA-1 du keystore de debug et celui de release sont DIFFÉRENTS.
> Créez deux Client ID : un pour le dev, un pour la prod.

---

## Partie 2 — Configuration Capacitor (~5 min)

### 2.1 Coller le Client ID dans index.html

Ouvrir `www/index.html`, ligne ~170 :

```javascript
// Avant
const GOOGLE_CLIENT_ID = 'VOTRE_CLIENT_ID.apps.googleusercontent.com';

// Après (exemple)
const GOOGLE_CLIENT_ID = '123456789-abcdefgh.apps.googleusercontent.com';
```

### 2.2 Configurer le deep link OAuth dans Capacitor

Dans `capacitor.config.json` :

```json
{
  "appId": "com.asthmetrack.app",
  "appName": "AsthmeTrack",
  "webDir": "www",
  "plugins": {
    "App": {
      "launchUrl": "com.asthmetrack.app"
    }
  }
}
```

### 2.3 Installer le plugin Browser (pour la popup OAuth)

```bash
npm install @capacitor/browser
npx cap sync
```

### 2.4 Configurer le deep link dans AndroidManifest.xml

Dans `android/app/src/main/AndroidManifest.xml`, dans le bloc `<activity>` principal, ajouter :

```xml
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data android:scheme="com.asthmetrack.app" />
</intent-filter>
```

### 2.5 Gérer le retour OAuth dans MainActivity

Dans `android/app/src/main/java/com/asthmetrack/app/MainActivity.java` :

```java
package com.asthmetrack.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        // Transmet le deep link OAuth à Capacitor/WebView
        if (intent != null && intent.getData() != null) {
            Uri data = intent.getData();
            if (data.getScheme() != null && data.getScheme().equals("com.asthmetrack.app")) {
                bridge.webView.loadUrl("javascript:window.handleCapacitorOAuth('" + data.toString() + "')");
            }
        }
    }
}
```

### 2.6 Ajouter le handler dans index.html

Juste avant la fermeture `</script>` dans `index.html`, ajouter :

```javascript
// Handler appelé par MainActivity quand Google redirige vers l'app
window.handleCapacitorOAuth = function(urlString) {
  const url = new URL(urlString);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (code && state) {
    handleOAuthCallback(code, state);
  }
};
```

---

## Partie 3 — Play Store (~30 min + attente validation)

### 3.1 Créer un compte développeur

1. Aller sur https://play.google.com/console
2. **Créer un compte développeur**
3. Payer les **25 $ uniques** (carte bancaire)
4. Vérifier votre identité (pièce d'identité demandée)

### 3.2 Créer l'application

1. **Créer une application**
2. Langue par défaut : Français
3. Titre : `AsthmeTrack`
4. Type : Application
5. Catégorie : Médecine ou Santé & Fitness

### 3.3 Générer l'APK de release signé

```bash
# Dans Android Studio
# Build → Generate Signed Bundle / APK → APK
# Créer un nouveau keystore ou utiliser l'existant
# Sélectionner "release"
```

Ou via Gradle :

```bash
cd android
./gradlew assembleRelease
```

Le fichier est dans :
`android/app/build/outputs/apk/release/app-release.apk`

### 3.4 Configurer la mise en vente

Dans la Play Console :

1. **Tests internes** → Créer une piste de test → ajouter votre email
2. Uploader l'APK
3. Remplir la fiche Play Store :
   - Description courte (80 car.) : `Suivi asthme : DEP, SpO₂, Easyhaler`
   - Description longue
   - 2 captures d'écran minimum
   - Icône 512×512 px
4. **Classification du contenu** → remplir le questionnaire
5. **Politique de confidentialité** : obligatoire (voir modèle ci-dessous)

### 3.5 Modèle de politique de confidentialité

Héberger ce texte sur une page web (GitHub Pages gratuit) :

```
AsthmeTrack — Politique de confidentialité

Données collectées : mesures DEP, SpO₂, prises Easyhaler, commentaires.

Stockage : vos données sont stockées localement sur votre appareil.
Si vous activez la synchronisation Google Drive, vos données sont 
sauvegardées dans votre propre Google Drive personnel. AsthmeTrack 
n'a pas accès à votre Google Drive.

Partage : aucune donnée n'est partagée avec des tiers.
Publicité : aucune.
Analyse : aucune.

Contact : votre@email.com
```

### 3.6 Délai de validation

- **Test interne** : disponible immédiatement
- **Production** : 3 à 7 jours (première fois)

---

## Résumé des coûts

| Élément | Coût |
|---------|------|
| Google Cloud (API Drive, OAuth) | Gratuit |
| Compte développeur Play Store | 25 $ une fois |
| GitHub Actions (build APK) | Gratuit |
| Total | **25 $** |

---

## Flow utilisateur final

```
Ouvre AsthmeTrack
       ↓
Réglages → "Se connecter avec Google"
       ↓
Popup Google native (même que Gmail)
       ↓
Choisit son compte Google
       ↓
✅ Connecté — données dans SON Drive
```

Aucune configuration requise de la part de l'utilisateur.

---

*AsthmeTrack v3 — Guide Play Store + OAuth*
