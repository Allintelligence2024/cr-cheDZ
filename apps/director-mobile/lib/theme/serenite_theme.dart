/// SÉRÉNITÉ — thème Flutter (clair + sombre).
///
/// Miroir Dart de `packages/design-system/src/theme.css`. Les valeurs sont
/// recopiées à l'identique : toute modification d'une couleur doit être faite
/// dans les DEUX fichiers pour que le web et le mobile restent alignés.
///
/// Les teintes claires ont été vérifiées WCAG AA (≥ 4.5:1) sur `surface` et
/// sur `background` — cf. `packages/design-system/src/contrast.test.mjs`.
/// Ne pas éclaircir `textMuted` / `success` sans refaire le calcul.
///
/// Les couleurs sémantiques (succès / alerte / danger / info) ne rentrent pas
/// dans un `ColorScheme` Material : elles sont exposées via l'extension de
/// thème [SereniteStatusColors], qui suit automatiquement le mode clair/sombre.
library;

import 'package:flutter/material.dart';

/// Palette du mode CLAIR — accent teal profond sur fond sauge.
abstract final class SereniteLight {
  static const Color primary = Color(0xFF0F766E);
  static const Color primaryHover = Color(0xFF115E59);
  static const Color primaryActive = Color(0xFF134E4A);
  static const Color primaryContrast = Color(0xFFFFFFFF);
  static const Color primarySoft = Color(0xFFECFDF8);
  static const Color primaryBorder = Color(0xFFC3EFE5);

  static const Color background = Color(0xFFF4F7F5);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color surfaceAlt = Color(0xFFFBFCFC);
  static const Color surfaceHover = Color(0xFFF4F7F5);

  static const Color text = Color(0xFF12211F);
  static const Color textMuted = Color(0xFF5A6E6A);
  static const Color textFaint = Color(0xFF7C8D88);

  static const Color border = Color(0xFFE6EDEA);
  static const Color borderStrong = Color(0xFFD3DEDA);

  static const Color success = Color(0xFF136A32);
  static const Color successBg = Color(0xFFE8F6ED);
  static const Color onSuccess = Color(0xFFFFFFFF);

  static const Color warning = Color(0xFFA35A06);
  static const Color warningBg = Color(0xFFFEF6E7);
  static const Color onWarning = Color(0xFFFFFFFF);

  static const Color danger = Color(0xFFBE123C);
  static const Color dangerBg = Color(0xFFFFF1F3);
  static const Color onDanger = Color(0xFFFFFFFF);

  static const Color info = Color(0xFF1D4ED8);
  static const Color infoBg = Color(0xFFEFF6FF);
  static const Color onInfo = Color(0xFFFFFFFF);
}

/// Palette du mode SOMBRE — charbon teinté vert, accent teal éclairci.
abstract final class SereniteDark {
  static const Color primary = Color(0xFF2DD4BF);
  static const Color primaryHover = Color(0xFF5EEAD4);
  static const Color primaryActive = Color(0xFF99F6E4);
  static const Color primaryContrast = Color(0xFF04201C);
  static const Color primarySoft = Color(0xFF11302C);
  static const Color primaryBorder = Color(0xFF1C4A43);

  static const Color background = Color(0xFF0B1413);
  static const Color surface = Color(0xFF121D1B);
  static const Color surfaceAlt = Color(0xFF162422);
  static const Color surfaceHover = Color(0xFF1B2B28);

  static const Color text = Color(0xFFE8F1EE);
  static const Color textMuted = Color(0xFF9BB0AB);
  static const Color textFaint = Color(0xFF6C837E);

  static const Color border = Color(0xFF223330);
  static const Color borderStrong = Color(0xFF2E433F);

  static const Color success = Color(0xFF4ADE80);
  static const Color successBg = Color(0xFF10291C);
  static const Color onSuccess = Color(0xFF04200F);

  static const Color warning = Color(0xFFFBBF24);
  static const Color warningBg = Color(0xFF2A2011);
  static const Color onWarning = Color(0xFF231803);

  static const Color danger = Color(0xFFFB7185);
  static const Color dangerBg = Color(0xFF2D1620);
  static const Color onDanger = Color(0xFF2A0710);

  static const Color info = Color(0xFF7DB1FF);
  static const Color infoBg = Color(0xFF14233A);
  static const Color onInfo = Color(0xFF05152E);
}

/// Couleurs sémantiques Sérénité, injectées dans [ThemeData.extensions].
///
/// Utiliser [SereniteStatusColors.of] plutôt que `Theme.of(context)
/// .extension<SereniteStatusColors>()!` : l'accesseur retombe sur la palette
/// claire si l'extension est absente (p. ex. un `MaterialApp` nu dans un test
/// widget), ce qui évite tout crash en environnement de test.
@immutable
class SereniteStatusColors extends ThemeExtension<SereniteStatusColors> {
  const SereniteStatusColors({
    required this.success,
    required this.successBg,
    required this.onSuccess,
    required this.warning,
    required this.warningBg,
    required this.onWarning,
    required this.danger,
    required this.dangerBg,
    required this.onDanger,
    required this.info,
    required this.infoBg,
    required this.onInfo,
    required this.textMuted,
    required this.textFaint,
    required this.border,
    required this.surfaceAlt,
  });

  final Color success;
  final Color successBg;
  final Color onSuccess;
  final Color warning;
  final Color warningBg;
  final Color onWarning;
  final Color danger;
  final Color dangerBg;
  final Color onDanger;
  final Color info;
  final Color infoBg;
  final Color onInfo;
  final Color textMuted;
  final Color textFaint;
  final Color border;
  final Color surfaceAlt;

  /// Jeu de couleurs du mode clair.
  static const SereniteStatusColors light = SereniteStatusColors(
    success: SereniteLight.success,
    successBg: SereniteLight.successBg,
    onSuccess: SereniteLight.onSuccess,
    warning: SereniteLight.warning,
    warningBg: SereniteLight.warningBg,
    onWarning: SereniteLight.onWarning,
    danger: SereniteLight.danger,
    dangerBg: SereniteLight.dangerBg,
    onDanger: SereniteLight.onDanger,
    info: SereniteLight.info,
    infoBg: SereniteLight.infoBg,
    onInfo: SereniteLight.onInfo,
    textMuted: SereniteLight.textMuted,
    textFaint: SereniteLight.textFaint,
    border: SereniteLight.border,
    surfaceAlt: SereniteLight.surfaceAlt,
  );

  /// Jeu de couleurs du mode sombre.
  static const SereniteStatusColors dark = SereniteStatusColors(
    success: SereniteDark.success,
    successBg: SereniteDark.successBg,
    onSuccess: SereniteDark.onSuccess,
    warning: SereniteDark.warning,
    warningBg: SereniteDark.warningBg,
    onWarning: SereniteDark.onWarning,
    danger: SereniteDark.danger,
    dangerBg: SereniteDark.dangerBg,
    onDanger: SereniteDark.onDanger,
    info: SereniteDark.info,
    infoBg: SereniteDark.infoBg,
    onInfo: SereniteDark.onInfo,
    textMuted: SereniteDark.textMuted,
    textFaint: SereniteDark.textFaint,
    border: SereniteDark.border,
    surfaceAlt: SereniteDark.surfaceAlt,
  );

  /// Récupère les couleurs sémantiques du thème courant (jamais nul).
  static SereniteStatusColors of(BuildContext context) =>
      Theme.of(context).extension<SereniteStatusColors>() ?? light;

  @override
  SereniteStatusColors copyWith({
    Color? success,
    Color? successBg,
    Color? onSuccess,
    Color? warning,
    Color? warningBg,
    Color? onWarning,
    Color? danger,
    Color? dangerBg,
    Color? onDanger,
    Color? info,
    Color? infoBg,
    Color? onInfo,
    Color? textMuted,
    Color? textFaint,
    Color? border,
    Color? surfaceAlt,
  }) {
    return SereniteStatusColors(
      success: success ?? this.success,
      successBg: successBg ?? this.successBg,
      onSuccess: onSuccess ?? this.onSuccess,
      warning: warning ?? this.warning,
      warningBg: warningBg ?? this.warningBg,
      onWarning: onWarning ?? this.onWarning,
      danger: danger ?? this.danger,
      dangerBg: dangerBg ?? this.dangerBg,
      onDanger: onDanger ?? this.onDanger,
      info: info ?? this.info,
      infoBg: infoBg ?? this.infoBg,
      onInfo: onInfo ?? this.onInfo,
      textMuted: textMuted ?? this.textMuted,
      textFaint: textFaint ?? this.textFaint,
      border: border ?? this.border,
      surfaceAlt: surfaceAlt ?? this.surfaceAlt,
    );
  }

  @override
  SereniteStatusColors lerp(
    covariant ThemeExtension<SereniteStatusColors>? other,
    double t,
  ) {
    if (other is! SereniteStatusColors) return this;
    return SereniteStatusColors(
      success: Color.lerp(success, other.success, t)!,
      successBg: Color.lerp(successBg, other.successBg, t)!,
      onSuccess: Color.lerp(onSuccess, other.onSuccess, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      warningBg: Color.lerp(warningBg, other.warningBg, t)!,
      onWarning: Color.lerp(onWarning, other.onWarning, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      dangerBg: Color.lerp(dangerBg, other.dangerBg, t)!,
      onDanger: Color.lerp(onDanger, other.onDanger, t)!,
      info: Color.lerp(info, other.info, t)!,
      infoBg: Color.lerp(infoBg, other.infoBg, t)!,
      onInfo: Color.lerp(onInfo, other.onInfo, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      textFaint: Color.lerp(textFaint, other.textFaint, t)!,
      border: Color.lerp(border, other.border, t)!,
      surfaceAlt: Color.lerp(surfaceAlt, other.surfaceAlt, t)!,
    );
  }
}

/// Construit les deux `ThemeData` Sérénité.
///
/// Volontairement minimal : l'essentiel du style découle du [ColorScheme]
/// (Material 3 en dérive cartes, dialogues, champs, etc.). On ne surcharge que
/// les composants dont le rendu par défaut s'écarte de la maquette.
abstract final class SereniteTheme {
  static const ColorScheme _lightScheme = ColorScheme(
    brightness: Brightness.light,
    primary: SereniteLight.primary,
    onPrimary: SereniteLight.primaryContrast,
    primaryContainer: SereniteLight.primarySoft,
    onPrimaryContainer: SereniteLight.primaryActive,
    secondary: SereniteLight.primaryHover,
    onSecondary: SereniteLight.primaryContrast,
    secondaryContainer: SereniteLight.primarySoft,
    onSecondaryContainer: SereniteLight.primaryActive,
    tertiary: SereniteLight.info,
    onTertiary: SereniteLight.onInfo,
    error: SereniteLight.danger,
    onError: SereniteLight.onDanger,
    errorContainer: SereniteLight.dangerBg,
    onErrorContainer: SereniteLight.danger,
    surface: SereniteLight.surface,
    onSurface: SereniteLight.text,
    onSurfaceVariant: SereniteLight.textMuted,
    // Sans ces valeurs, les `surfaceContainer*` retombent sur `surface`
    // (blanc) et les aplats subtils (placeholders, cartes en relief)
    // deviennent invisibles.
    surfaceDim: SereniteLight.background,
    surfaceBright: SereniteLight.surface,
    surfaceContainerLowest: SereniteLight.surface,
    surfaceContainerLow: SereniteLight.surfaceAlt,
    surfaceContainer: SereniteLight.background,
    surfaceContainerHigh: SereniteLight.surfaceHover,
    surfaceContainerHighest: SereniteLight.surfaceHover,
    outline: SereniteLight.borderStrong,
    outlineVariant: SereniteLight.border,
    shadow: Color(0xFF102824),
    scrim: Color(0xFF102824),
    inverseSurface: SereniteDark.surface,
    onInverseSurface: SereniteDark.text,
    inversePrimary: SereniteDark.primary,
    surfaceTint: SereniteLight.primary,
  );

  static const ColorScheme _darkScheme = ColorScheme(
    brightness: Brightness.dark,
    primary: SereniteDark.primary,
    onPrimary: SereniteDark.primaryContrast,
    primaryContainer: SereniteDark.primarySoft,
    onPrimaryContainer: SereniteDark.primaryActive,
    secondary: SereniteDark.primaryHover,
    onSecondary: SereniteDark.primaryContrast,
    secondaryContainer: SereniteDark.primarySoft,
    onSecondaryContainer: SereniteDark.primaryActive,
    tertiary: SereniteDark.info,
    onTertiary: SereniteDark.onInfo,
    error: SereniteDark.danger,
    onError: SereniteDark.onDanger,
    errorContainer: SereniteDark.dangerBg,
    onErrorContainer: SereniteDark.danger,
    surface: SereniteDark.surface,
    onSurface: SereniteDark.text,
    onSurfaceVariant: SereniteDark.textMuted,
    surfaceDim: SereniteDark.background,
    surfaceBright: SereniteDark.surfaceHover,
    surfaceContainerLowest: SereniteDark.background,
    surfaceContainerLow: SereniteDark.surface,
    surfaceContainer: SereniteDark.surfaceAlt,
    surfaceContainerHigh: SereniteDark.surfaceHover,
    surfaceContainerHighest: SereniteDark.surfaceHover,
    outline: SereniteDark.borderStrong,
    outlineVariant: SereniteDark.border,
    shadow: Color(0xFF000000),
    scrim: Color(0xFF000000),
    inverseSurface: SereniteLight.surface,
    onInverseSurface: SereniteLight.text,
    inversePrimary: SereniteLight.primary,
    surfaceTint: SereniteDark.primary,
  );

  /// Thème clair (défaut).
  static ThemeData get light => _build(
        scheme: _lightScheme,
        background: SereniteLight.background,
        status: SereniteStatusColors.light,
        snackBackground: SereniteLight.text,
        snackForeground: SereniteLight.surface,
      );

  /// Thème sombre.
  static ThemeData get dark => _build(
        scheme: _darkScheme,
        background: SereniteDark.background,
        status: SereniteStatusColors.dark,
        snackBackground: SereniteDark.surfaceHover,
        snackForeground: SereniteDark.text,
      );

  static ThemeData _build({
    required ColorScheme scheme,
    required Color background,
    required SereniteStatusColors status,
    required Color snackBackground,
    required Color snackForeground,
  }) {
    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      extensions: <ThemeExtension<dynamic>>[status],
      // Flutter ≥ 3.35 : `ThemeData.appBarTheme` attend un `AppBarThemeData`
      // (normalisation des thèmes de composants), pas un `AppBarTheme`.
      appBarTheme: AppBarThemeData(
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 1,
      ),
      dividerTheme: DividerThemeData(
        color: status.border,
        thickness: 1,
        space: 1,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: status.textMuted,
        textColor: scheme.onSurface,
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: snackBackground,
        contentTextStyle: TextStyle(color: snackForeground),
        behavior: SnackBarBehavior.floating,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          // 44 px : même cible tactile minimale que sur le web.
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(0, 44),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: scheme.primary,
          minimumSize: const Size(0, 44),
        ),
      ),
    );
  }
}
