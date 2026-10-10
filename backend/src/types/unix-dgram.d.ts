declare module "unix-dgram" {
  import { EventEmitter } from "node:events";

  export type SocketType = "unix_dgram";

  export interface UnixDgramSocket extends EventEmitter {
    bind(path: string): void;
    send(
      msg: Buffer,
      offset: number,
      length: number,
      path: string,
      callback?: (error: Error | null) => void,
    ): void;
    close(): void;
  }

  export function createSocket(type: SocketType): UnixDgramSocket;
}
