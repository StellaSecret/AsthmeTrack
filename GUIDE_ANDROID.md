# 📱 Guide — AsthmeTrack → APK Android avec Capacitor

## Pré-requis

- PC Windows / Mac / Linux
- Connexion internet
- Environ 1h pour l'installation complète

---

## Étape 1 — Installer Node.js

1. Télécharger : https://nodejs.org (version LTS)
2. Installer avec les options par défaut
3. Vérifier dans un terminal :
   ```
   node --version
   npm --version
   ```

---

## Étape 2 — Installer Android Studio

1. Télécharger : https://developer.android.com/studio
2. Installer Android Studio
3. Ouvrir Android Studio → **More Actions** → **SDK Manager**
4. Cocher et installer :
   - Android SDK Platform 34
   - Android SDK Build-Tools
   - Android Emulator (optionnel)
5. Configurer la variable d'environnement `ANDROID_HOME` :
   - **Windows** : `C:\Users\<Vous>\AppData\Local\Android\Sdk`
   - **Mac/Linux** : `~/Library/Android/sdk` ou `~/Android/Sdk`

---

## Étape 3 — Créer le projet Capacitor

Ouvrir un terminal et exécuter :

```bash
# Créer un dossier de projet
mkdir asthmetrack
cd asthmetrack

# Initialiser npm
npm init -y

# Installer Capacitor
npm install @capacitor/core @capacitor/cli @capacitor/android

# Initialiser Capacitor
npx cap init AsthmeTrack com.asthmetrack.app --web-dir www
```

---

## Étape 4 — Préparer les fichiers

```bash
# Créer le dossier www
mkdir www

# Copier index.html dans www/
# (glisser-déposer le fichier index.html téléchargé dans le dossier www/)
```

Votre structure doit ressembler à :
```
asthmetrack/
├── www/
│   └── index.html
├── package.json
└── node_modules/
```

---

## Étape 5 — Ajouter la plateforme Android

```bash
npx cap add android
npx cap sync
```

---

## Étape 6 — Notifications natives (optionnel mais recommandé)

Pour des rappels qui fonctionnent même app fermée :

```bash
npm install @capacitor/local-notifications
npx cap sync
```

Ajouter dans `android/app/src/main/AndroidManifest.xml` (après `</manifest>`) :
```xml
<uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
```

---

## Étape 7 — Générer l'APK

```bash
# Ouvrir le projet dans Android Studio
npx cap open android
```

Dans Android Studio :
1. Attendre la synchronisation Gradle (peut prendre 5–10 min la première fois)
2. Menu **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. Cliquer sur **locate** dans la notification pour trouver l'APK
4. L'APK se trouve dans : `android/app/build/outputs/apk/debug/app-debug.apk`

---

## Étape 8 — Installer sur votre téléphone

**Option A — Câble USB :**
1. Sur le téléphone : Paramètres → À propos → taper 7 fois sur "Numéro de build"
2. Paramètres → Options développeur → Débogage USB → Activer
3. Dans Android Studio : choisir votre téléphone → ▶ Run

**Option B — Fichier APK direct :**
1. Copier `app-debug.apk` sur le téléphone (USB ou cloud)
2. Sur le téléphone : ouvrir le fichier APK
3. Autoriser l'installation depuis source inconnue si demandé
4. Installer

---

## Commandes de mise à jour

Pour mettre à jour l'app après modification de `index.html` :

```bash
cp chemin/vers/index.html www/index.html
npx cap sync
npx cap open android
# Puis Build → Build APK(s)
```

---

## Dépannage

| Problème | Solution |
|----------|----------|
| `ANDROID_HOME not set` | Vérifier la variable d'environnement |
| Gradle timeout | Vérifier connexion internet, relancer |
| `cap` non reconnu | Utiliser `npx cap` à la place |
| APK non installable | Activer "Sources inconnues" dans les paramètres Android |

---

## Structure finale du projet

```
asthmetrack/
├── android/              ← Projet Android Studio
│   └── app/
│       └── build/outputs/apk/debug/
│           └── app-debug.apk  ← Votre APK !
├── www/
│   └── index.html        ← Votre application
├── capacitor.config.json
└── package.json
```

---

## Ressources

- Documentation Capacitor : https://capacitorjs.com/docs
- Local Notifications : https://capacitorjs.com/docs/apis/local-notifications
- Forum : https://forum.ionicframework.com

---

*AsthmeTrack — Suivi asthme personnel | Généré avec AsthmeTrack v1.0*
