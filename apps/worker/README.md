# Worker — notifications push

Le worker livre les notifications sur FCM HTTP v1 et, pour iOS sans jeton FCM, APNs HTTP/2 direct.

## FCM HTTP v1

`FIREBASE_SERVICE_ACCOUNT_JSON` contient le JSON complet du service account Firebase (sur une seule ligne). Le compte doit avoir le droit Firebase Cloud Messaging API Admin.

## APNs direct

- `APNS_KEY_ID`
- `APNS_TEAM_ID`
- `APNS_BUNDLE_ID`
- `APNS_PRIVATE_KEY` : clé `.p8` PEM ; les retours à la ligne peuvent être encodés `\n`.
- `APNS_PRODUCTION=true` pour `api.push.apple.com`; sinon le sandbox Apple est utilisé.

Les erreurs fournisseur déclenchent le retry exponentiel de `notification_queue`. Les jetons ne doivent jamais être journalisés.
