import { createNameSpace } from '@_linked/core/utils/NameSpace';

/**
 * Matrix bridge ontology (TBox). These terms describe how a LINKED application's
 * graph mirrors Matrix state — an identity mapping and a room binding — so a host
 * can resolve entity→room and MXID→subject without asking the homeserver, and so
 * safety audits can reconstruct a room's audience from durable data.
 *
 * The vocabulary is deliberately host-neutral: it says "subject" and "bound
 * entity", never any one product's domain classes.
 */
export const ns = createNameSpace('https://id.linked.cm/matrix/');
export const _self = ns('');

// ── classes ──
/** Mirror of a subject's derived Matrix identity. */
export const MatrixIdentity = ns('MatrixIdentity');
/** Binding between a host entity and the Matrix room that realizes its conversation. */
export const MatrixRoomBinding = ns('MatrixRoomBinding');

// ── identity properties ──
/** → the subject (a Person/Agent IRI) this Matrix identity belongs to. */
export const forSubject = ns('forSubject');
/** Derived opaque Matrix user id, e.g. '@p_…:chat.example.org'. Never PII. */
export const mxid = ns('mxid');

// ── room-binding properties ──
/** → the host entity (team/mission/event/conversation IRI) this room realizes. */
export const boundEntity = ns('boundEntity');
/** Opaque Matrix room id, e.g. '!abc:chat.example.org'. */
export const roomId = ns('roomId');
/** Host taxonomy key for the channel within its space. */
export const channelKey = ns('channelKey');
/** 'public' | 'team' | 'personal' — the privacy tier the room realizes. */
export const tier = ns('tier');
/** Host audience key — enforced as room membership by the appservice. */
export const audience = ns('audience');
/** True when the room carries m.room.encryption. */
export const encrypted = ns('encrypted');
