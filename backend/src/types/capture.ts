export type IouIf = {
  slot: number;
  port: number;
};

export type CaptureStream = {
  type: "tcp";
  target: string;
  writePacket: (payload: Buffer) => void;
  close: () => void;
};

export type CaptureSession = {
  id: number;
  labId: string;
  linkId: string;
  link: {
    a: { nodeId: string; instanceId: number; intf: IouIf };
    b: { nodeId: string; instanceId: number; intf: IouIf };
  };
  dlt: number;
  stream: CaptureStream;
  createdAt: number;
  packetTaps: Set<(payload: Buffer) => void>;
};

export type NetioProxy = {
  nodeId: string;
  instanceId: number;
  socketPath: string;
  realPath: string;
  refCount: number;
  socket: {
    on: (event: "message", listener: (msg: Buffer) => void) => void;
    send: (msg: Buffer, offset: number, length: number, path: string) => void;
    close: () => void;
  };
};

export type CaptureState = {
  proxies: Map<string, NetioProxy>; // key: nodeId
  sessions: Map<number, CaptureSession>; // key: captureId
  linkToSessions: Map<string, Set<number>>; // key: linkId
  flowToSessions: Map<string, Set<number>>; // key: `${srcNodeId}:${srcIntf.slot}/${srcIntf.port}->${dstNodeId}:${dstIntf.slot}/${dstIntf.port}`
};

export type NetioHeader = {
  dstInstanceId: number;
  srcInstanceId: number;
  dstIntf: IouIf;
  srcIntf: IouIf;
};

export type CaptureResult = {
  captureId: number;
  captureUrl: string;
  linkId: string;
  dlt: number;
  createdAt?: number;
};
