import '../../core/database/app_database.dart';

/// Modèle enfant (couche domaine) — construit depuis la ligne locale Drift.
class Child {
  const Child({
    required this.id,
    required this.organizationId,
    required this.siteId,
    required this.firstNameFr,
    required this.lastNameFr,
    required this.dateOfBirth,
    required this.status,
    this.roomId,
    this.allergiesSummary,
  });

  final String id;
  final String organizationId;
  final String siteId;
  final String firstNameFr;
  final String lastNameFr;
  final String dateOfBirth;
  final String status;
  final String? roomId;
  final String? allergiesSummary;

  factory Child.fromLocal(LocalChildren row) {
    return Child(
      id: row.id,
      organizationId: row.organizationId,
      siteId: row.siteId,
      firstNameFr: row.firstNameFr,
      lastNameFr: row.lastNameFr,
      dateOfBirth: row.dateOfBirth,
      status: row.status,
      roomId: row.roomId,
      allergiesSummary: row.allergiesSummary,
    );
  }
}
