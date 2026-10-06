// @_linked/matrix/backend — SERVER-ONLY. Never import this from client code:
// it reads the appservice registration and holds the as_token.
export {
  ensureMatrixSession,
  matrixAsToken,
  matrixHsToken,
  type MatrixBridgeConfig,
  type MatrixIdentity,
} from './identity.js';

export {
  createMatrixSessionHandler,
  registerMatrixRoutes,
  type DisplayNameFromRequest,
  type EnsureMatrixSessionFn,
  type MatrixRouteServer,
  type MatrixSessionHandler,
  type MatrixSessionHandlerOptions,
  type MatrixSessionRequest,
  type MatrixSessionResponse,
  type WebIdFromRequest,
} from './routes.js';
