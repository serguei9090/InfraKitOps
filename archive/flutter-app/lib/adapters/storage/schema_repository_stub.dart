import '../../core/ports/i_schema_repository.dart';
import 'web_schema_repository.dart';

/// Web-safe half of the conditional import in
/// schema_repository_factory.dart — selected automatically whenever
/// `dart:io` isn't available (i.e. web builds), so this file must never
/// import `dart:io` itself, directly or transitively.
ISchemaRepository createPlatformSchemaRepository() => WebSchemaRepository();
