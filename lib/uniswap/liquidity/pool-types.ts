/**
 * Pool Types - Local definitions replacing @uniswap/client-data-api protobuf types
 * These enums mirror the Uniswap protocol's position and version definitions.
 */

export enum PositionStatus {
  UNSPECIFIED = 0,
  IN_RANGE = 1,
  OUT_OF_RANGE = 2,
  CLOSED = 3,
}

export enum ProtocolVersion {
  UNSPECIFIED = 0,
  V2 = 1,
  V3 = 2,
  V4 = 3,
}
