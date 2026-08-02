# DPIA / AIPD — Vidéosurveillance des locaux de crèche

> **Statut : RÉDIGÉE (modèle de plateforme) — validation DPO/ANPDP par crèche
> requise avant toute activation.**
>
> Ce document est l'analyse d'impact relative à la protection des données
> (AIPD/DPIA) exigée par la **loi n° 25-11 du 24 juillet 2025** (modifiant la
> loi n° 18-07 du 10 juin 2018) pour le traitement « Vidéosurveillance des
> locaux ». Il sert de **modèle** : chaque crèche (responsable de traitement)
> doit l'adapter à ses locaux, créer sa DPIA via l'API `POST /privacy/dpias`
> (modèle du registre « Vidéosurveillance des locaux », migration 046) et la
> faire **approuver** avant que le flag `video_surveillance` puisse être activé
> par la console support (garde-fou technique en place — migration 046 +
> `PrivacyService.assertFlagComplianceGate`).
>
> **Périmètre logiciel : AUCUN module de vidéosurveillance n'est développé ni
> déployé.** Ce document est le préalable obligatoire ; il ne vaut pas
> implémentation.

| Champ | Valeur |
|---|---|
| Traitement | Vidéosurveillance des locaux (entrées, espaces communs) |
| Responsable de traitement | La crèche (chaque organisation cliente) |
| Sous-traitant | Éditeur de la plateforme (hébergement Algérie) |
| Référence registre | `Vidéosurveillance des locaux` (modèle global, `requires_dpia = true`, `is_active = false`) |
| Révision prévue | annuelle (champ `review_date` = approbation + 365 jours) |

---

## 1. Contexte et objet

Les crèches algériennes (décret exécutif n° 19-253) accueillent des enfants de
3 mois à 6 ans — des personnes **particulièrement vulnérables**. Certaines
structures souhaitent filmer les entrées et espaces communs pour la sûreté des
enfants et des personnels. Ce traitement porte sur des **images de mineurs** :
la loi 25-11 le classe parmi les traitements sensibles soumis à analyse
d'impact **avant** toute mise en œuvre, avec consultation préalable de
l'**ANPDP** si le risque résiduel reste élevé.

## 2. Description du traitement

| Élément | Détail |
|---|---|
| Finalité | Sûreté des personnes et des biens ; constatation d'incidents ; dissuasion des intrusions |
| Données | Images vidéo des locaux (pas de son), horodatage |
| Personnes concernées | Enfants, personnel, parents/visiteurs (accès et espaces communs) |
| Zones filmées | Entrées, couloirs, espaces communs. **Interdites** : sanitaires, zones de change, salles de sieste, infirmerie |
| Destinataires | Directeur/directrice de la crèche + DPO ; autorités judiciaires sur réquisition |
| Durée de conservation | **30 jours maximum** puis écrasement automatique (`retention_days = 30`) |
| Transferts | Aucun transfert transfrontalier (hébergement Algérie) ; tout transfert ultérieur exigerait une autorisation ANPDP au cas par cas |
| Base légale | Intérêt légitime du responsable de traitement (sécurité), sous réserve des droits des personnes |

## 3. Nécessité et proportionnalité

- **Alternatives évaluées** : contrôle d'accès badgé (existant dans la
  plateforme via les pointages), journal des incidents (module journal,
  existant). La vidéo n'est retenue que comme **complément** ciblant les
  zones de circulation, jamais les espaces de vie intime.
- **Minimisation** : pas de son, pas de reconnaissance faciale, pas
  d'analyse comportementale, nombre de caméras limité aux zones listées.
- **Proportionnalité** : la finalité de sûreté d'enfants vulnérables est
  légitime, mais toute extension (zones, analyse, durée) remet la
  proportionnalité en cause et impose une révision de la DPIA.

## 4. Évaluation des risques (échelle : faible / modérée / élevée)

| Risque | Probabilité | Gravité | Risque brut |
|---|---|---|---|
| Visionnage abusif des images par du personnel non autorisé (voyeurisme, surveillance des employés) | élevée | élevée | **élevé** |
| Fuite d'images de mineurs (intrusion, partage non autorisé) | modérée | critique | **élevé** |
| Conservation excessive faute de purge | élevée | modérée | **élevé** |
| Captation de zones interdites (mauvais pointage des caméras) | modérée | élevée | **élevé** |
| Utilisation détournée (pression sur le personnel, procédures disciplinaires) | modérée | élevée | **élevé** |
| Demande d'accès non honorée dans les délais | faible | modérée | modéré |

## 5. Mesures d'atténuation (obligatoires avant activation)

Techniques :
- Accès aux images **restreint par rôle** (directeur + DPO uniquement) et
  **journalisé** (audit_logs — pattern existant de la plateforme).
- **Chiffrement au repos** du stockage, flux limité au réseau local de la
  crèche ; aucun accès distant tiers sans contrat.
- Purge automatique à 30 jours ; toute extraction est tracée et datée.
- Masquage physique des zones interdites (pointage des caméras validé à
  l'installation, contrôlé à chaque déplacement).

Organisationnelles :
- **Information des personnes** : affichage visible à l'entrée (FR + AR) et
  information du personnel par écrit.
- Consignation : tout visionnage fait l'objet d'une note d'audit (qui, quand,
  pourquoi).
- Interdiction contractuelle d'utilisation à des fins disciplinaires hors
  incident de sûreté.
- Violation de données : notification **ANPDP sous 5 jours** (workflow
  `/privacy/violations` existant).

Après mesures, le risque résiduel est évalué **modéré** ; s'il devait rester
élevé (ex. : volonté de reconnaissance faciale), la consultation préalable de
l'ANPDP serait **obligatoire** et ce modèle ne saurait être utilisé.

## 6. Avis et consultation

- **DPO de la plateforme** : avis favorable **sous conditions** (mesures §5
  toutes effectives, zones interdites respectées, purge 30 jours vérifiée).
- Personnel : à consulter par chaque crèche avant installation (traçabilité
  dans les notes DPIA).

## 7. Décision et conditions d'activation (techniques)

1. La crèche adapte ce modèle (zones réelles, nombre de caméras, référent).
2. Création de la DPIA dans la plateforme : `POST /privacy/dpias` avec
   `processing_registry_id` du modèle « Vidéosurveillance des locaux »,
   `risk_assessment` (§4 adapté) et `mitigation_measures` (§5).
3. Approbation par direction + DPO : `POST /privacy/dpias/:id/approve`
   (révision programmée à +365 j).
4. **Alors seulement**, la console support peut activer le flag
   `video_surveillance` pour l'organisation — sinon l'API répond
   `422 DPIA_REQUIRED` ; toute activation **globale** est refusée
   (`422 VIDEO_SURVEILLANCE_GLOBAL_FORBIDDEN`).
5. Le module logiciel de vidéosurveillance reste à planifier (hors périmètre
   MVP) : flux vidéo, purge 30 j, journalisation des visionnages.

## 8. Révision

- Annuelle (`review_date`), à chaque changement de zones/caméras, après tout
  incident de sûreté impliquant les images, et après toute violation notifiée.

---

## الملخص (Résumé en arabe)

هذا المستند هو **تقييم أثر حماية البيانات** المطلوب بموجب القانون رقم 25-11
المعدّل للقانون 18-07 قبل أي نشر لنظام المراقبة بالفيديو في دور الحضانة:

- **الغرض**: حماية الأطفال والموظفين (المداخل والأماكن المشتركة فقط، دون صوت،
  دون المراحيض وغرف تغيير الملابس وقاعات القيلولة والممرضة).
- **مدة الاحتفاظ**: 30 يوماً كحد أقصى ثم الحذف التلقائي.
- **الوصول**: المدير + مسؤول حماية البيانات فقط، مع تسجيل كل مشاهدة.
- **الإجراء**: لا يمكن تفعيل خاصية `video_surveillance` إلا بعد اعتماد تقييم
  الأثر الخاص بكل مؤسسة داخل المنصة (`POST /privacy/dpias` ثم `approve`) —
  وإلا تردّ المنصة `422 DPIA_REQUIRED`. التفعيل العام ممنوع.
- **الحالة**: نموذج مُعدّ — يتطلب مواءمة كل حضانة واعتماد مسؤول حماية
  البيانات/ANPDP عند الاقتضاء. **لم يتم تطوير أي برنامج مراقبة بعد.**
