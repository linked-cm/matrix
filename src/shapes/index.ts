/**
 * Registers every shape this package defines, and nothing else.
 *
 * A shape registers when its module is evaluated, so this module exists to be
 * imported for that side effect alone: `import '@linked.cm/matrix/shapes/index'`.
 * It has no exports. Ontology registration stays in the package entry, which
 * imports this module after the ontology.
 */
import './MatrixIdentity.js';
import './MatrixRoomBinding.js';
