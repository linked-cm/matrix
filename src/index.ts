// @_linked/matrix — a Matrix transport for @_linked/messaging.
export {
  assertMatrixEnforcement,
  type MatrixEnforcementRequirement,
  type MatrixEnforcementSession,
} from './enforcement.js';
//
// The seam lives in @_linked/messaging; this package implements it. Side-effect
// imports register the ontology and shapes into the LINKED tree (ontology FIRST,
// then shapes), matching every other LINKED package.
import './package.js';
import './ontologies/matrix.js';
import './shapes/index.js';

export * from './package.js';
export * as mx from './ontologies/matrix.js';
export { MatrixIdentityShape } from './shapes/MatrixIdentity.js';
export { MatrixRoomBindingShape } from './shapes/MatrixRoomBinding.js';

export {
  DEFAULT_MATRIX_NAMESPACE,
  pollTypesFor,
  resolveMatrixNamespace,
  type MatrixNamespaceConfig,
} from './config.js';

export { isSubjectMxid, localpartForWebId, mxidForWebId } from './mxid.js';

export {
  aggregatePolls,
  channelKeyOf,
  excerptOf,
  findMyReactionEventId,
  mediaOf,
  mxcToHttp,
  replyFallbackBody,
  stripReplyFallback,
  toMessages,
  toSpaces,
  toThreads,
  typingNamesOf,
  type PollAggregate,
  type RoomSnapshot,
  type TimelineItem,
  type TypingMember,
} from './mapping.js';

export {
  createTypingThrottle,
  shouldMarkRead,
  TYPING_SERVER_TIMEOUT_MS,
} from './presence.js';
