/**
 * Registers every shape this package defines, after its ontology.
 *
 * A shape registers when its module is evaluated, so this module exists to be
 * imported for that side effect alone: `import '@linked.cm/matrix/shapes/index'`.
 * It has no exports. It registers the ontology first, as the package entry does,
 * so an app that imports only this module still has the package's ontology data.
 */
import '../ontologies/matrix.register.js';
import './MatrixIdentity.js';
import './MatrixRoomBinding.js';
